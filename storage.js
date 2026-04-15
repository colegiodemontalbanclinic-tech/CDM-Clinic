const SUPABASE_URL = 'https://cbenviudczmhrthvqntc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiZW52aXVkY3ptaHJ0aHZxbnRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjAyMDcsImV4cCI6MjA5MTAzNjIwN30.oxBJwGZmta9B-qZi4_zmr_71-ktx-fafS_JidP9IWu0';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tableBody = document.querySelector('#medicineTable tbody');
let port = null;
let medicines = [];
let espConfigSynced = false;
let serialWriter = null;
let readLoopRunning = false;
let serialBuffer = "";

// Retry logic for database loading
let medicineLoadRetries = 0;
const MAX_MEDICINE_RETRIES = 3;

// FIX: Track if expiry warning was already shown
let expiryWarningShown = false;

// ============================================
// CLOCK / TIMESTAMP FUNCTIONS (From Dashboard)
// ============================================
function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const dateTimeElement = document.getElementById('dateTime');
    if (dateTimeElement) {
        dateTimeElement.textContent = `${dateStr} | ${timeStr}`;
    }
}

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage') || toast;
  
  // Set icon based on type
  let icon = 'fa-info-circle';
  if (type === 'warning' || type === 'critical') icon = 'fa-exclamation-triangle';
  else if (type === 'caution') icon = 'fa-exclamation-circle';
  else if (type === 'success') icon = 'fa-check-circle';
  
  // Update toast content with icon
  toast.innerHTML = `<i class="fas ${icon}"></i><span id="toastMessage">${message}</span>`;
  
  // Apply type classes
  toast.className = 'toast ' + type;
  
  // Show toast
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  // Auto-hide after 5 seconds (keep visible for critical)
  const hideDelay = type === 'critical' ? 8000 : 5000;
  setTimeout(() => {
    toast.classList.remove('show');
  }, hideDelay);
}

// ============================================
// SIGN OUT MODAL FUNCTIONS (Dashboard Match)
// ============================================
function showSignOutModal(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('signOutModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeSignOutModal() {
    const modal = document.getElementById('signOutModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function confirmSignOut() {
    // Add your sign out logic here
    // For example: clear session, redirect to login
    window.location.href = 'login.html';
}

// ============================================
// EXPIRY MANAGEMENT SYSTEM
// ============================================
function getExpiryStatus(expDateStr) {
  if (!expDateStr) return { status: 'unknown', days: 0, text: 'No date', icon: 'fa-question-circle' };
  
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const expDate = new Date(expDateStr);
    
    if (isNaN(expDate.getTime())) {
      return { status: 'unknown', days: 0, text: 'Invalid date', icon: 'fa-question-circle' };
    }
    
    expDate.setHours(0, 0, 0, 0);
    
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return { status: 'expired', days: diffDays, text: 'EXPIRED', icon: 'fa-calendar-times' };
    if (diffDays <= 7) return { status: 'near', days: diffDays, text: `${diffDays}d left`, icon: 'fa-clock' };
    return { status: 'good', days: diffDays, text: `${diffDays}d left`, icon: 'fa-calendar-check' };
  } catch (err) {
    console.error('Error calculating expiry status:', err);
    return { status: 'unknown', days: 0, text: 'Error', icon: 'fa-exclamation-circle' };
  }
}

async function loadMedicines() {
  console.log('Loading medicines from database...');
  
  // Show loading state
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px;">
    <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:rgba(144,238,144,0.8);"></i>
    <p style="margin-top:10px; color:rgba(255,255,255,0.7);">Loading inventory...</p>
  </td></tr>`;

  try {
    const { data, error } = await supabaseClient
      .from('medicines')
      .select('*')
      .order('slot_id', { ascending: true });

    if (error) {
      console.error('Database fetch failed:', error);
      
      // Retry logic
      if (medicineLoadRetries < MAX_MEDICINE_RETRIES) {
        medicineLoadRetries++;
        console.log(`Retrying... Attempt ${medicineLoadRetries}/${MAX_MEDICINE_RETRIES}`);
        setTimeout(() => loadMedicines(), 2000 * medicineLoadRetries);
        return;
      }
      
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:#ff9f9f;">
        <i class="fas fa-exclamation-circle" style="font-size:2rem; margin-bottom:10px;"></i>
        <p>Error loading data: ${error.message}</p>
        <p style="font-size:0.85rem; opacity:0.7;">Check browser console (F12) for details</p>
      </td></tr>`;
      updateTableStatus('error', 'Failed to load data');
      showToast('Failed to load medicine data', 'critical');
      return;
    }

    // Success - reset retry counter
    medicineLoadRetries = 0;

    if (!data || data.length === 0) {
      medicines = [];
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:rgba(255,255,255,0.6);">
        <i class="fas fa-inbox" style="font-size:2rem; margin-bottom:10px; display:block;"></i>
        No medicines in inventory
      </td></tr>`;
      updateTableStatus('ready', 'System Ready');
      return;
    }

    medicines = data;
    displayMedicines(data);
    updateSyncStatus();
    
    // Check and display expiry warnings after loading
    checkAndDisplayExpiryWarnings();
    updateTableStatus('ready', 'System Ready');
    
    console.log(`Loaded ${medicines.length} medicines from database`);

  } catch (err) {
    console.error('Exception loading medicines:', err);
    
    if (medicineLoadRetries < MAX_MEDICINE_RETRIES) {
      medicineLoadRetries++;
      setTimeout(() => loadMedicines(), 2000 * medicineLoadRetries);
      return;
    }
    
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:#ff9f9f;">
      <i class="fas fa-exclamation-circle" style="font-size:2rem; margin-bottom:10px;"></i>
      <p>Error: ${err.message}</p>
    </td></tr>`;
    updateTableStatus('error', 'Failed to load data');
    showToast('Failed to load medicine data', 'critical');
  }
}

function updateTableStatus(state, message) {
  const statusBadge = document.getElementById('tableStatus');
  if (!statusBadge) return;
  
  const icons = {
    ready: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    loading: 'fa-spinner fa-spin',
    warning: 'fa-exclamation-triangle'
  };
  
  const classes = {
    ready: 'status-synced',
    error: 'status-pending',
    loading: 'status-pending',
    warning: 'status-pending'
  };
  
  statusBadge.className = `status-badge ${classes[state] || 'status-synced'}`;
  statusBadge.innerHTML = `<i class="fas ${icons[state] || 'fa-check-circle'}"></i> ${message}`;
}

function checkAndDisplayExpiryWarnings() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let expiredCount = 0;
  let nearExpiryCount = 0;
  let expiredMeds = [];
  let nearExpiryMeds = [];
  
  medicines.forEach(med => {
    if (!med.expiration_date) return;
    
    const expDate = new Date(med.expiration_date);
    expDate.setHours(0, 0, 0, 0);
    
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      expiredCount++;
      expiredMeds.push(`${med.med_name} (${Math.abs(diffDays)}d ago)`);
    } else if (diffDays <= 7) {
      nearExpiryCount++;
      nearExpiryMeds.push(`${med.med_name} (${diffDays}d left)`);
    }
  });
  
  // Update banner
  const banner = document.getElementById('expiryBanner');
  const countSpan = document.getElementById('expiryCount');
  
  if (expiredCount > 0 || nearExpiryCount > 0) {
    countSpan.textContent = expiredCount + nearExpiryCount;
    banner.classList.add('show');
    
    // Update table status for critical expiry
    if (expiredCount > 0) {
      updateTableStatus('warning', `${expiredCount} Expired Items`);
    }
    
    // Show toast warnings (only once per session for non-critical)
    if (!expiryWarningShown) {
      if (expiredCount > 0) {
        showToast(`${expiredCount} medicine(s) EXPIRED: ${expiredMeds.slice(0, 3).join(', ')}${expiredMeds.length > 3 ? '...' : ''}`, 'critical');
      }
      if (nearExpiryCount > 0) {
        setTimeout(() => {
          showToast(`${nearExpiryCount} medicine(s) expiring soon: ${nearExpiryMeds.slice(0, 3).join(', ')}${nearExpiryMeds.length > 3 ? '...' : ''}`, 'caution');
        }, expiredCount > 0 ? 1500 : 0);
      }
      expiryWarningShown = true;
    }
  } else {
    banner.classList.remove('show');
  }
  
  return { expiredCount, nearExpiryCount, expiredMeds, nearExpiryMeds };
}

// Manual check expiry button
document.getElementById('checkExpiryBtn').addEventListener('click', () => {
  // Reset warning flag to allow re-checking
  expiryWarningShown = false;
  const result = checkAndDisplayExpiryWarnings();
  
  if (result.expiredCount === 0 && result.nearExpiryCount === 0) {
    showToast('All medicines are within safe expiry dates', 'success');
    updateTableStatus('ready', 'All Items Valid');
  } else {
    let msg = '';
    if (result.expiredCount > 0) {
      msg += `${result.expiredCount} EXPIRED. `;
    }
    if (result.nearExpiryCount > 0) {
      msg += `${result.nearExpiryCount} expiring within 7 days.`;
    }
    showToast(msg, result.expiredCount > 0 ? 'critical' : 'caution');
  }
});

// ============================================
// DISPLAY FUNCTIONS
// ============================================
function displayMedicines(list) {
  tableBody.innerHTML = '';
  
  if (list.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:rgba(255,255,255,0.6);">
      <i class="fas fa-inbox" style="font-size:2rem; margin-bottom:10px; display:block;"></i>
      No medicines in inventory
    </td></tr>`;
    return;
  }
  
  // Sort: expired first, then low stock, then near expiry, then by slot
  const sortedList = [...list].sort((a, b) => {
    const aExpiry = getExpiryStatus(a.expiration_date);
    const bExpiry = getExpiryStatus(b.expiration_date);
    
    const priority = { 'expired': 0, 'near': 1, 'unknown': 2, 'good': 3 };
    
    if (priority[aExpiry.status] !== priority[bExpiry.status]) {
      return priority[aExpiry.status] - priority[bExpiry.status];
    }
    
    const aQty = a.quantity !== null && a.quantity !== undefined ? a.quantity : 0;
    const bQty = b.quantity !== null && b.quantity !== undefined ? b.quantity : 0;
    
    if (aQty === 0 && bQty !== 0) return -1;
    if (bQty === 0 && aQty !== 0) return 1;
    if (aQty <= 5 && bQty > 5) return -1;
    if (bQty <= 5 && aQty > 5) return -1;
    
    return a.slot_id - b.slot_id;
  });
  
  sortedList.forEach(med => {
    const row = document.createElement('tr');
    
    // Get expiry status with detailed classification
    const expiryInfo = getExpiryStatus(med.expiration_date);
    
    // Apply row styling based on expiry
    if (expiryInfo.status === 'expired') {
      row.classList.add('expired');
    } else if (expiryInfo.status === 'near') {
      row.classList.add('near-expiry');
    }
    
    // Create expiry badge with icon
    const badgeHtml = `<span class="expiry-badge ${expiryInfo.status}">
      <i class="fas ${expiryInfo.icon}"></i> ${expiryInfo.text}
    </span>`;
    
    // Quantity display with color coding - FIXED null safety
    const qty = med.quantity !== null && med.quantity !== undefined ? med.quantity : 0;
    const qtyColor = qty === 0 ? '#ff9f9f' : (qty <= 5 ? '#ffd700' : (qty <= 15 ? '#ffd700' : 'rgba(144, 238, 144, 1)'));
    
    // Stock status text
    let stockStatusText = 'Good';
    if (qty === 0) stockStatusText = 'Out';
    else if (qty <= 5) stockStatusText = 'Low';
    else if (qty <= 15) stockStatusText = 'Medium';
    
    row.innerHTML = `
      <td><span class="weight-display">#${med.slot_id}</span></td>
      <td style="font-weight:600; color:#ffffff;">${med.med_name}</td>
      <td style="font-weight:700; color:${qtyColor};" id="qty-${med.slot_id}" title="Stock Status: ${stockStatusText}">
        ${qty}
        <small style="display:block; font-size:0.7rem; opacity:0.8; font-weight:400;">${stockStatusText}</small>
      </td>
      <td class="weight-display" id="weight-${med.slot_id}">${med.pill_gram !== null && med.pill_gram !== undefined ? med.pill_gram.toFixed(3) : '0.000'}g</td>
      <td>
        <div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
          <span style="font-size:0.85rem;">${med.expiration_date || 'Not set'}</span>
          ${badgeHtml}
        </div>
      </td>
      <td>
        <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
          <button class="edit-btn" onclick="openModal(${med.slot_id}, '${med.med_name.replace(/'/g, "\\'")}', ${med.pill_gram || 0}, '${med.expiration_date || ''}', ${med.id})" title="Edit Medicine">
            <i class="fas fa-edit"></i>
          </button>
          <button class="tare-btn" onclick="handleTare(${med.slot_id})" title="Tare Scale">
            <i class="fas fa-weight-hanging"></i>
          </button>
        </div>
      </td>`;
    tableBody.appendChild(row);
  });
}

function updateSyncStatus() {
  const syncBadge = document.getElementById('syncStatus');
  const serialStatus = document.getElementById('serialStatus');
  
  if (espConfigSynced) {
    syncBadge.innerHTML = '<i class="fas fa-check-circle"></i> DB: Synced';
    syncBadge.className = "status-badge status-synced";
    serialStatus.innerHTML = '<i class="fas fa-wifi" style="margin-right:4px;"></i>Connected';
    serialStatus.style.color = "#32cd32";
  } else {
    if (port) {
      syncBadge.innerHTML = '<i class="fas fa-sync-alt fa-spin" style="font-size:0.8em;"></i> DB: Pending Sync';
      serialStatus.innerHTML = '<i class="fas fa-plug" style="margin-right:4px;"></i>Connected';
      serialStatus.style.color = "#ffd700";
    } else {
      syncBadge.innerHTML = '<i class="fas fa-times-circle"></i> DB: Disconnected';
      serialStatus.innerHTML = '<i class="fas fa-unlink" style="margin-right:4px;"></i>Disconnected';
      serialStatus.style.color = "#ff3737";
    }
    syncBadge.className = "status-badge status-pending";
  }
}

// ============================================
// MODAL FUNCTIONS
// ============================================
function openModal(slot, name, weight, exp, id) {
  document.getElementById('editSlot').value = slot;
  document.getElementById('editId').value = id;
  document.getElementById('editName').value = name || '';
  document.getElementById('editWeight').value = weight || 0;
  document.getElementById('editExp').value = exp || '';
  
  const modal = document.getElementById('editModal');
  modal.style.display = 'block';
  
  // Focus on name input after modal opens
  setTimeout(() => document.getElementById('editName').focus(), 100);
}

function closeModal() { 
  const modal = document.getElementById('editModal');
  modal.style.display = 'none';
  
  // Clear form
  document.getElementById('editSlot').value = '';
  document.getElementById('editId').value = '';
  document.getElementById('editName').value = '';
  document.getElementById('editWeight').value = '';
  document.getElementById('editExp').value = '';
}

// Save button handler
document.getElementById('saveBtn').addEventListener('click', async () => {
  const slot = parseInt(document.getElementById('editSlot').value);
  const id = document.getElementById('editId').value;
  const name = document.getElementById('editName').value.trim().toUpperCase();
  const weight = parseFloat(document.getElementById('editWeight').value);
  const exp = document.getElementById('editExp').value;

  // Validation
  if (!name) {
    showToast('Please enter a medicine name', 'caution');
    document.getElementById('editName').focus();
    return;
  }
  
  if (isNaN(weight) || weight <= 0) {
    showToast('Please enter a valid pill weight greater than 0', 'caution');
    document.getElementById('editWeight').focus();
    return;
  }

  // Update local data
  const medIndex = medicines.findIndex(m => m.id == id);
  if (medIndex !== -1) {
    medicines[medIndex].med_name = name;
    medicines[medIndex].pill_gram = weight;
    medicines[medIndex].expiration_date = exp;
  }

  // Update database
  const { error } = await supabaseClient.from('medicines').update({ 
    med_name: name, 
    pill_gram: weight, 
    expiration_date: exp 
  }).eq('id', id);

  if (error) {
    showToast("Database update failed: " + error.message, 'critical');
    return;
  }

  // Check if new expiry date is concerning
  const newExpiry = getExpiryStatus(exp);
  if (newExpiry.status === 'expired') {
    showToast(`Warning: ${name} expiry date is in the past!`, 'critical');
  } else if (newExpiry.status === 'near') {
    showToast(`Caution: ${name} expires in ${newExpiry.days} days`, 'caution');
  } else {
    showToast(`${name} updated successfully`, 'success');
  }

  // Sync to ESP32 if connected
  if (port?.writable) {
    await sendConfigToESP(slot, name, weight);
    displayMedicines(medicines);
    checkAndDisplayExpiryWarnings(); // Re-check after update
  } else {
    displayMedicines(medicines);
    checkAndDisplayExpiryWarnings();
  }

  closeModal();
});

// ============================================
// ESP32 SERIAL COMMUNICATION
// ============================================
async function sendConfigToESP(slot, name, weight) {
  if (!port?.writable) return false;
  
  try {
    const writer = port.writable.getWriter();
    const cmd = `SET_CONFIG:${slot},${name},${weight.toFixed(3)}\n`;
    const encoder = new TextEncoder();
    
    await writer.write(encoder.encode(cmd));
    writer.releaseLock();
    
    return true;
  } catch (err) {
    console.error("Failed to send config:", err);
    showToast("Failed to sync to ESP32: " + err.message, 'warning');
    return false;
  }
}

async function syncAllConfigToESP() {
  if (!port?.writable || medicines.length === 0) return;
  
  espConfigSynced = false;
  updateSyncStatus();
  
  showToast('Syncing configuration to ESP32...', 'success');
  
  try {
    for (const med of medicines) {
      const success = await sendConfigToESP(med.slot_id, med.med_name, med.pill_gram);
      if (!success) throw new Error('Failed to send config for slot ' + med.slot_id);
      await new Promise(r => setTimeout(r, 150));
    }
    
    const writer = port.writable.getWriter();
    await writer.write(new TextEncoder().encode("CONFIG_SYNC_DONE\n"));
    writer.releaseLock();
    
    espConfigSynced = true;
    updateSyncStatus();
    showToast('All configurations synced to ESP32', 'success');
  } catch (err) {
    espConfigSynced = false;
    updateSyncStatus();
    showToast('Sync failed: ' + err.message, 'warning');
  }
}

document.getElementById('syncToEspBtn').addEventListener('click', syncAllConfigToESP);

// Tare All button
document.getElementById('tareAllBtn').addEventListener('click', async () => {
  if (!port?.writable) {
    showToast("ESP32 not connected", 'caution');
    return;
  }
  
  try {
    const writer = port.writable.getWriter();
    const cmd = "TARE_ALL\n";
    await writer.write(new TextEncoder().encode(cmd));
    writer.releaseLock();
    
    showToast("All scales tared successfully", 'success');
  } catch (err) {
    console.error("Tare All failed:", err);
    showToast("Failed to tare all scales: " + err.message, 'warning');
  }
});

// Connect button
document.getElementById('connectBtn').addEventListener('click', async () => {
  try {
    if (port && port.readable) {
      showToast('Already connected to ESP32', 'success');
      return;
    }
    
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    
    updateSyncStatus();
    
    serialBuffer = "";
    readSerialData();
    
    showToast('Connected to ESP32', 'success');
    setTimeout(syncAllConfigToESP, 1000);
  } catch (err) { 
    showToast("Connection failed: " + err.message, 'warning');
    console.error(err);
  }
});

// Individual tare handler
async function handleTare(slotId) {
  if (!port?.writable) {
    showToast("ESP32 not connected", 'caution');
    return;
  }
  
  try {
    const writer = port.writable.getWriter();
    const cmd = `TARE:${slotId}\n`;
    await writer.write(new TextEncoder().encode(cmd));
    writer.releaseLock();
    
    showToast(`Slot ${slotId} tared`, 'success');
  } catch (err) {
    console.error("Tare failed:", err);
    showToast("Failed to tare: " + err.message, 'warning');
  }
}

// Serial reading loop
async function readSerialData() {
  if (readLoopRunning) return;
  readLoopRunning = true;
  
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      serialBuffer += decoder.decode(value, { stream: true });
      
      let lines = serialBuffer.split("\n");
      serialBuffer = lines.pop();
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        processSerialLine(trimmed);
      }
    }
  } catch (e) { 
    console.error("Serial read error:", e);
    showToast("Serial connection error", 'warning');
  } finally { 
    reader.releaseLock();
    readLoopRunning = false;
    
    document.getElementById('serialStatus').innerHTML = '<i class="fas fa-unlink" style="margin-right:4px;"></i>Disconnected';
    document.getElementById('serialStatus').style.color = "#ff9f9f";
    document.getElementById('syncToEspBtn').disabled = true;
    document.getElementById('tareAllBtn').disabled = true;
    espConfigSynced = false;
    updateSyncStatus();
    port = null;
  }
}

function processSerialLine(line) {
  if (line.startsWith("UPDATE:")) {
    const parts = line.substring(7).split(",");
    if (parts.length >= 2) {
      const name = parts[0].trim().toUpperCase();
      const qty = parseInt(parts[1]);
      
      if (isNaN(qty)) return;
      
      const med = medicines.find(m => m.med_name.toUpperCase() === name);
      if (med) {
        supabaseClient.from('medicines')
          .update({ quantity: qty })
          .eq('id', med.id)
          .then(({ error }) => {
            if (error) return;
            const qtyCell = document.getElementById(`qty-${med.slot_id}`);
            if (qtyCell) {
              qtyCell.textContent = qty;
              // Update color based on quantity - FIXED null safety
              const qtyColor = qty === 0 ? '#ff9f9f' : (qty <= 5 ? '#ffd700' : (qty <= 15 ? '#ffd700' : 'rgba(144, 238, 144, 1)'));
              qtyCell.style.color = qtyColor;
            }
            med.quantity = qty;
          });
      }
    }
  }
  else if (line === "REQUEST_CONFIG") {
    setTimeout(syncAllConfigToESP, 100);
  }
  else if (line.startsWith("MSG:")) {
    const msg = line.substring(4);
    console.log("ESP32:", msg);
    if (msg.includes("Tared") || msg.includes("saved")) {
      showToast(msg, 'success');
    }
  }
}

// ============================================
// REALTIME SUBSCRIPTION
// ============================================
const channel = supabaseClient
  .channel('medicines-changes')
  .on('postgres_changes', { 
    event: '*', 
    schema: 'public', 
    table: 'medicines' 
  }, (payload) => {
    loadMedicines();
  })
  .subscribe();

// ============================================
// EVENT LISTENERS & INITIALIZATION
// ============================================

// Close modal on outside click
window.onclick = function(event) {
  const editModal = document.getElementById('editModal');
  const signOutModal = document.getElementById('signOutModal');
  
  if (event.target === editModal) {
    closeModal();
  }
  if (event.target === signOutModal) {
    closeSignOutModal();
  }
};

// Handle escape key to close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeSignOutModal();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (port && port.readable) {
    port.close();
  }
  channel.unsubscribe();
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadMedicines();
  
  // Initialize timestamp from dashboard
  updateDateTime();
  setInterval(updateDateTime, 1000);
  
  // Setup sign out button - Dashboard style
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', showSignOutModal);
  }
});

// Make functions globally available for HTML onclick handlers
window.openModal = openModal;
window.closeModal = closeModal;
window.handleTare = handleTare;
window.showSignOutModal = showSignOutModal;
window.closeSignOutModal = closeSignOutModal;
window.confirmSignOut = confirmSignOut;