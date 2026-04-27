/**
 * Storage Management - Large Inventory Dashboard
 * Connected to Supabase for inventory data with barcode scanner integration
 * Modified: Removed camera scanner, added auto-search from History code
 * Modified: Removed EmailJS, email alerts, inventory alerts, and location field
 * NEW: Serial port list display, auto-refresh every 30s, row click to edit
 * UPDATED: Uses shared-data.js for Supabase client and inventory functions
 * UPDATED: Date/time format matches Dashboard, search placeholder updated, edit icons removed
 * UPDATED: Dashboard-style Quantity & Status badges with icons
 * NEW: Delete confirmation modal before deleting medicine rows
 * FIXED: Delete function now properly targets only the selected row by ID
 * FIXED: Added missing updateInventoryBadge function
 * FIXED: Immediate local removal + forced redraw after delete to ensure row disappears
 */

// ============================================
// DOM Elements
// ============================================
const elements = {
  dateTime: document.getElementById('dateTime'),
  totalItems: document.getElementById('totalItems'),
  expiredCount: document.getElementById('expiredCount'),
  expiringSoonCount: document.getElementById('expiringSoonCount'),
  searchBox: document.getElementById('searchBox'),
  autoScanPanel: document.getElementById('autoScanPanel'),
  lastScanBarcode: document.getElementById('lastScanBarcode'),
  lastScanInfo: document.getElementById('lastScanInfo'),
  lastScanAction: document.getElementById('lastScanAction'),
  largeTable: document.getElementById('largeTable'),
  inventoryBadge: document.getElementById('inventoryBadge'),
  // Modals
  largeModal: document.getElementById('largeModal'),
  quickAddModal: document.getElementById('quickAddModal'),
  lookupModal: document.getElementById('lookupModal'),
  signOutModal: document.getElementById('signOutModal'),
  deleteConfirmModal: document.getElementById('deleteConfirmModal'),
  // Modal inputs
  itemId: document.getElementById('itemId'),
  barcode: document.getElementById('barcode'),
  boxName: document.getElementById('boxName'),
  quantity: document.getElementById('quantity'),
  expDate: document.getElementById('expDate'),
  notes: document.getElementById('notes'),
  lookupStatus: document.getElementById('lookupStatus'),
  // Quick add inputs
  quickBarcode: document.getElementById('quickBarcode'),
  quickBoxName: document.getElementById('quickBoxName'),
  quickQuantity: document.getElementById('quickQuantity'),
  quickExpDate: document.getElementById('quickExpDate'),
  // Delete confirmation elements
  deleteItemName: document.getElementById('deleteItemName'),
  deleteItemId: document.getElementById('deleteItemId'),
  confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
  // Buttons
  saveLargeBtn: document.getElementById('saveLargeBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  cancelSignOut: document.getElementById('cancelSignOut'),
  confirmSignOut: document.getElementById('confirmSignOut'),
  // Toast
  storageToast: document.getElementById('storageToast'),
  toastMessage: document.getElementById('toastMessage')
};

// ============================================
// State Variables
// ============================================
let largeInventory = [];
let autoScanMode = false;
let autoRefreshInterval = null;
const AUTO_REFRESH_DELAY = 30000; // 30 seconds
let pendingDeleteId = null;   // Stores the ID of item awaiting deletion confirmation

// ============================================
// Utility Functions (from History code)
// ============================================

/**
 * Debounce function - copied from history.js
 * Prevents search from firing too frequently
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction() {
        const args = arguments;
        const later = function() {
            clearTimeout(timeout);
            func.apply(null, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', initStorage);

function initStorage() {
  console.log('Initializing storage management...');
  
  // Load inventory data using shared-data.js function
  loadLargeInventory();
  
  // Setup event listeners
  setupEventListeners();
  
  // NEW: Setup scanner auto-detection listeners
  setupScannerEventListeners();
    
  // Start auto-refresh every 30 seconds
  startAutoRefresh();
}

function setupEventListeners() {
  // NEW: Auto-search with debounce (from History code)
  elements.searchBox.addEventListener('input', debounce(applyFilters, 300));
  
  // Save buttons
  elements.saveLargeBtn.addEventListener('click', saveLargeItem);
  
  // Delete confirmation
  elements.confirmDeleteBtn.addEventListener('click', confirmDeleteItem);
  
  // Sign out modal
  elements.signOutBtn.addEventListener('click', showSignOutModal);
  elements.cancelSignOut.addEventListener('click', closeSignOutModal);
  elements.confirmSignOut.addEventListener('click', performSignOut);
  
  // Close modals on outside click
  window.addEventListener('click', (e) => {
    const modals = document.getElementsByClassName('modal');
    for (let modal of modals) {
      if (e.target === modal) modal.style.display = 'none';
    }
  });
  
  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
  });
}

// ============================================
// NEW: Auto-Search Filter Function (from History code)
// ============================================

/**
 * Apply filters with auto-search functionality
 * Automatically filters as user types (with debounce)
 * Search by box_name and barcode
 */
function applyFilters() {
  const query = elements.searchBox.value.toLowerCase().trim();
  
  if (!query) {
    displayLargeInventory(largeInventory);
    updateInventoryBadge();
    return;
  }
  
  // Search by box_name AND barcode
  const filtered = largeInventory.filter(item => 
    item.box_name.toLowerCase().includes(query) ||
    (item.barcode && item.barcode.toLowerCase().includes(query))
  );
  
  displayLargeInventory(filtered);
  
  // Update badge to show search results
  const badge = elements.inventoryBadge;
  if (filtered.length === 0) {
    badge.textContent = 'No Results';
    badge.className = 'badge badge-warning';
    showToast('No items found matching your search', 'warning');
  } else {
    badge.textContent = `${filtered.length} Found`;
    badge.className = 'badge badge-success';
  }
}

/**
 * Clear search and reset to full inventory
 */
function clearSearch() {
  elements.searchBox.value = '';
  displayLargeInventory(largeInventory);
  updateInventoryBadge();
  showToast('Search cleared', 'success');
}

// ============================================
// NEW: Auto-Refresh Functionality
// ============================================

function startAutoRefresh() {
  // Clear any existing interval
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  // Set up new interval
  autoRefreshInterval = setInterval(() => {
    console.log('Auto-refreshing inventory...');
    loadLargeInventory();
    showToast('Inventory refreshed automatically', 'success');
  }, AUTO_REFRESH_DELAY);
  
  console.log('Auto-refresh started: every 30 seconds');
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log('Auto-refresh stopped');
  }
}

// ============================================
// Inventory Data Loading - USING SHARED-DATA.JS
// FIXED: Direct Supabase call with immediate redraw
// ============================================

async function loadLargeInventory() {
  if (!storageSupabaseClient) {
    showTableError('Database not connected');
    return;
  }
  
  try {
    console.log('Fetching fresh inventory data...');
    
    const { data, error } = await storageSupabaseClient
      .from('large_inventory')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) {
      console.error('Error loading inventory:', error);
      showTableError('Failed to load inventory: ' + error.message);
      return;
    }
    
    console.log(`Retrieved ${data ? data.length : 0} records from database`);
    
    largeInventory = data || [];
    displayLargeInventory(largeInventory);
    updateStats();
    updateInventoryBadge();
    
  } catch (err) {
    console.error('Exception loading inventory:', err);
    showTableError('Failed to load inventory: ' + err.message);
  }
}

function showTableError(message) {
  const tbody = elements.largeTable.querySelector('tbody');
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="table-error">
        <i class="fa-solid fa-circle-exclamation"></i>
        Error: ${message}
      </td>
    </tr>
  `;
}

function displayLargeInventory(list) {
  const tbody = elements.largeTable.querySelector('tbody');
  tbody.innerHTML = '';
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          <i class="fa-solid fa-inbox"></i>
          No items in inventory
        </td>
      </tr>
    `;
    return;
  }
  
  list.forEach((item, index) => {
    const row = document.createElement('tr');
    
    // Use shared-data.js functions for status calculation
    const expiryInfo = getInventoryExpiryStatus(item.expiration_date, today);
    const stockStatus = getInventoryStockStatus(item.quantity);
    
    let status = 'Good';
    let statusClass = 'status-good';
    let statusIcon = 'check';
    
    // Determine display status based on expiry and stock
    if (expiryInfo.status === 'expired') {
      row.classList.add('expired');
      status = 'EXPIRED';
      statusClass = 'status-expired';
      statusIcon = 'circle-xmark';
    } else if (expiryInfo.status === 'near') {
      row.classList.add('expiring-soon');
      status = `Expiring (${expiryInfo.daysLeft}d)`;
      statusClass = 'status-warning';
      statusIcon = 'clock';
    } else if (stockStatus === 'out') {
      status = 'OUT OF STOCK';
      statusClass = 'status-expired';
      statusIcon = 'circle-xmark';
    } else if (stockStatus === 'low') {
      status = 'Low Stock';
      statusClass = 'status-warning';
      statusIcon = 'triangle-exclamation';
    }
    
    // Animation delay based on index
    row.style.opacity = '0';
    row.style.animation = `slideDown 0.3s ease ${index * 0.05}s forwards`;
    
    // NEW: Make row clickable to open edit modal
    row.style.cursor = 'pointer';
    row.title = 'Click to edit this item';
    
    row.addEventListener('click', (e) => {
      // Prevent opening modal if clicking action buttons
      if (e.target.closest('.action-buttons') || e.target.closest('button')) {
        return;
      }
      openLargeEditModal(item.id);
    });
    
    // UPDATED: Dashboard-style quantity badge with icon
    const qtyBadgeClass = stockStatus === 'out' ? 'qty-zero' : stockStatus === 'low' ? 'qty-low' : 'qty-good';
    const qtyIcon = stockStatus === 'out' ? 'circle-xmark' : stockStatus === 'low' ? 'triangle-exclamation' : 'check';
    
    // Build row HTML matching History table design - 7 columns (removed location)
    // EDIT ICONS REMOVED: Only lookup and delete buttons remain in Actions column
    // UPDATED: Dashboard-style Quantity and Status badges with icons
    // NEW: Delete button now opens confirmation modal instead of direct delete
    // FIXED: Properly escape box name for HTML attributes to prevent XSS
    const escapedBoxName = item.box_name ? item.box_name.replace(/'/g, "\\'").replace(/"/g, '&quot;') : 'Unknown Item';
    
    row.innerHTML = `
      <td><strong>#${item.id}</strong></td>
      <td>
        <div class="item-name">
          <i class="fa-solid fa-box"></i>
          ${item.box_name || 'Unnamed'}
        </div>
      </td>
      <td>
        <span class="barcode-display">
          <i class="fa-solid fa-barcode"></i>
          ${item.barcode || 'N/A'}
        </span>
      </td>
      <td style="text-align: center;">
        <span class="quantity-badge ${qtyBadgeClass}">
          <i class="fa-solid fa-${qtyIcon}"></i>
          ${item.quantity !== null && item.quantity !== undefined ? item.quantity : 0}
        </span>
      </td>
      <td>${item.expiration_date || 'N/A'}</td>
      <td style="text-align: center;">
        <span class="status-badge ${statusClass}">
          <i class="fa-solid fa-${statusIcon}"></i>
          ${status}
        </span>
      </td>
      <td>
        <div class="action-buttons" onclick="event.stopPropagation()">
          <button class="btn-icon btn-view" onclick="lookupBarcode('${item.barcode || ''}')" title="Lookup">
            <i class="fa-solid fa-magnifying-glass"></i>
          </button>
          <button class="btn-icon btn-delete" onclick="showDeleteConfirmModal(${parseInt(item.id, 10)}, '${escapedBoxName}')" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    
    tbody.appendChild(row);
  });
}

function updateStats() {
  // Use shared-data.js function for accurate calculations
  const stats = getLargeInventoryStats(largeInventory);
  
  elements.totalItems.textContent = stats.total;
  elements.expiredCount.textContent = stats.expiredCount;
  elements.expiringSoonCount.textContent = stats.nearExpiryCount;
}

// ============================================
// NEW: Inventory Badge Update Function
// FIXED: Previously missing function causing "updateInventoryBadge is not defined" error
// ============================================

/**
 * Update the inventory badge showing total items count
 * Displays badge on the inventory card/header
 */
function updateInventoryBadge() {
  const badge = elements.inventoryBadge;
  if (!badge) return; // Safety check if element doesn't exist
  
  const total = largeInventory ? largeInventory.length : 0;
  
  if (total === 0) {
    badge.textContent = 'No Items';
    badge.className = 'badge badge-warning';
  } else {
    badge.textContent = `${total} Items`;
    badge.className = 'badge badge-success';
  }
}

// ============================================
// NEW: Refresh Table Function with Spinner
// ============================================

async function refreshTable() {
  const refreshBtn = document.querySelector('.btn-icon[onclick="refreshTable()"] i');
  
  // Add spinning animation
  if (refreshBtn) {
    refreshBtn.classList.add('fa-spin');
    refreshBtn.parentElement.classList.add('refreshing');
  }
  
  showToast('Refreshing inventory...', 'success');
  
  try {
    await loadLargeInventory();
    showToast('Inventory refreshed successfully', 'success');
  } catch (err) {
    showToast('Error refreshing: ' + err.message, 'critical');
  } finally {
    // Remove spinning animation after 1 second minimum
    setTimeout(() => {
      if (refreshBtn) {
        refreshBtn.classList.remove('fa-spin');
        refreshBtn.parentElement.classList.remove('refreshing');
      }
    }, 1000);
  }
}

/**
 * Start reading barcode data from scanner
 */
async function startScannerReader() {
  if (!scannerPort || !scannerPort.readable) return;

  const decoder = new TextDecoder();
  scannerBuffer = '';

  try {
    while (scannerPort.readable) {
      scannerReader = scannerPort.readable.getReader();
      
      try {
        while (true) {
          const { value, done } = await scannerReader.read();
          if (done) break;
          
          const text = decoder.decode(value, { stream: true });
          scannerBuffer += text;
          
          // Check for barcode termination (newline or carriage return)
          if (scannerBuffer.includes('\n') || scannerBuffer.includes('\r')) {
            const lines = scannerBuffer.split(/[\r\n]+/);
            // Process complete lines
            for (let i = 0; i < lines.length - 1; i++) {
              const barcode = lines[i].trim();
              if (barcode) {
                console.log('Scanned barcode:', barcode);
                await handleScannedBarcode(barcode);
              }
            }
            scannerBuffer = lines[lines.length - 1]; // Keep incomplete data
          }
        }
      } catch (readErr) {
        console.error('Read error:', readErr);
      } finally {
        scannerReader.releaseLock();
        scannerReader = null;
      }
    }
  } catch (err) {
    console.error('Scanner reader error:', err);
    updateScannerStatus(false);
  }
}

// ============================================
// Barcode Lookup & Auto-Fill
// ============================================

function handleBarcodeKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupBarcodeAndFill();
  }
}

async function lookupBarcodeAndFill() {
  const barcode = elements.barcode.value.trim();
  const statusDiv = elements.lookupStatus;
  
  if (!barcode) {
    statusDiv.className = 'lookup-status not-found';
    statusDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Please enter or scan a barcode first';
    statusDiv.style.display = 'block';
    return;
  }
  
  statusDiv.className = 'lookup-status';
  statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Looking up barcode...';
  statusDiv.style.display = 'block';
  
  // Use storageSupabaseClient from shared-data.js
  const { data: items, error } = await storageSupabaseClient
    .from('large_inventory')
    .select('*')
    .eq('barcode', barcode);
  
  if (error) {
    statusDiv.className = 'lookup-status not-found';
    statusDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Data error: ${error.message}`;
    return;
  }
  
  if (items && items.length > 0) {
    const item = items[0];
    
    elements.itemId.value = item.id;
    elements.boxName.value = item.box_name;
    elements.quantity.value = item.quantity;
    elements.expDate.value = item.expiration_date || '';
    elements.notes.value = item.notes || '';
    
    elements.boxName.classList.add('auto-filled');
    
    statusDiv.className = 'lookup-status found';
    statusDiv.innerHTML = `
      <i class="fa-solid fa-circle-check"></i>
      <strong>Found!</strong> Auto-filled from data.<br>
      <small>Box: ${item.box_name} | Qty: ${item.quantity}</small>
    `;
    
    showScanFeedback('success', `Auto-filled: ${item.box_name}`);
  } else {
    elements.itemId.value = '';
    elements.boxName.value = '';
    elements.boxName.classList.remove('auto-filled');
    elements.quantity.value = '1';
    elements.expDate.value = '';
    elements.notes.value = '';
    
    statusDiv.className = 'lookup-status not-found';
    statusDiv.innerHTML = `
      <i class="fa-solid fa-circle-question"></i>
      <strong>Not found in data.</strong><br>
      <small>This is a new item. Fill in the details and save.</small>
    `;
  }
}

async function handleScannedBarcode(barcode) {
  console.log('Scanned:', barcode);
  
  elements.lastScanBarcode.textContent = barcode;
  elements.lastScanInfo.classList.add('show');
  
  if (elements.largeModal.style.display === 'block') {
    elements.barcode.value = barcode;
    await lookupBarcodeAndFill();
    return;
  }
  
  if (elements.quickAddModal.style.display === 'block') {
    elements.quickBarcode.value = barcode;
    return;
  }
  
  elements.barcode.value = barcode;
  openAddModal();
  await lookupBarcodeAndFill();
}

function showScanFeedback(type, message) {
  const notif = document.createElement('div');
  notif.className = `scan-feedback ${type}`;
  notif.innerHTML = `
    <i class="fa-solid fa-${type === 'success' ? 'circle-check' : 'circle-exclamation'}"></i>
    ${message}
  `;
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.opacity = '0';
    notif.style.transform = 'translateY(-20px)';
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

// ============================================
// Modal Functions
// ============================================

function openAddModal() {
  elements.itemId.value = '';
  elements.barcode.value = '';
  elements.boxName.value = '';
  elements.boxName.classList.remove('auto-filled');
  elements.quantity.value = '1';
  elements.expDate.value = '';
  elements.notes.value = '';
  elements.lookupStatus.style.display = 'none';
  elements.largeModal.style.display = 'block';
}

async function openLargeEditModal(id) {
  const item = largeInventory.find(i => i.id === id);
  if (!item) return;
  
  elements.itemId.value = item.id;
  elements.barcode.value = item.barcode || '';
  elements.boxName.value = item.box_name;
  elements.boxName.classList.remove('auto-filled');
  elements.quantity.value = item.quantity;
  elements.expDate.value = item.expiration_date || '';
  elements.notes.value = item.notes || '';
  elements.lookupStatus.style.display = 'none';
  elements.largeModal.style.display = 'block';
}

function closeLargeModal() {
  elements.largeModal.style.display = 'none';
}

function openQuickAddModal(barcode) {
  elements.quickBarcode.value = barcode;
  elements.quickBoxName.value = '';
  elements.quickQuantity.value = '1';
  elements.quickExpDate.value = '';
  elements.quickAddModal.style.display = 'block';
  setTimeout(() => elements.quickBoxName.focus(), 100);
}

function closeQuickAddModal() {
  elements.quickAddModal.style.display = 'none';
}

function closeLookupModal() {
  elements.lookupModal.style.display = 'none';
}

function closeSignOutModal() {
  elements.signOutModal.style.display = 'none';
}

function showSignOutModal() {
  elements.signOutModal.style.display = 'flex';
}

// ============================================
// FIXED: Delete Confirmation Modal Functions
// Ensures only the selected row is deleted from the database
// FIXED: Immediate local removal + forced redraw so row disappears instantly
// ============================================

/**
 * Show delete confirmation modal for a specific item
 * @param {number} id - The numeric ID of the item to delete
 * @param {string} boxName - The name of the item for display
 */
function showDeleteConfirmModal(id, boxName) {
  // CRITICAL FIX: Ensure ID is a valid integer
  const numericId = parseInt(id, 10);
  
  if (isNaN(numericId) || numericId <= 0) {
    console.error('Invalid ID passed to showDeleteConfirmModal:', id);
    showToast('Error: Invalid item ID', 'critical');
    return;
  }
  
  pendingDeleteId = numericId;
  elements.deleteItemName.textContent = boxName || 'Unknown Item';
  elements.deleteItemId.textContent = `#${numericId}`;
  elements.deleteConfirmModal.style.display = 'block';
  
  // Add pulse animation to the danger button
  elements.confirmDeleteBtn.classList.add('pulsing');
}

function closeDeleteConfirmModal() {
  elements.deleteConfirmModal.style.display = 'none';
  pendingDeleteId = null;
  elements.confirmDeleteBtn.classList.remove('pulsing');
}

/**
 * Confirm and execute deletion of the selected item ONLY
 * Uses .eq('id', pendingDeleteId) to target exactly one row
 * FIXED: Immediate local removal + forced redraw so row disappears right away
 */
async function confirmDeleteItem() {
  // Validate that we have a pending delete ID
  if (!pendingDeleteId || isNaN(pendingDeleteId)) {
    showToast('Error: No item selected for deletion', 'critical');
    closeDeleteConfirmModal();
    return;
  }
  
  // Show loading state on button
  const originalBtnContent = elements.confirmDeleteBtn.innerHTML;
  elements.confirmDeleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
  elements.confirmDeleteBtn.disabled = true;
  
  try {
    console.log(`Deleting item with ID: ${pendingDeleteId} from large_inventory...`);
    
    // CRITICAL FIX: Use .eq() with the specific numeric ID to delete ONLY this row
    const { data, error } = await storageSupabaseClient
      .from('large_inventory')
      .delete()
      .eq('id', pendingDeleteId)
      .select(); // Return the deleted row to confirm deletion
      
    if (error) {
      console.error('Supabase delete error:', error);
      throw new Error(error.message);
    }
    
    console.log('Delete response from server:', data);
    
    // IMMEDIATE LOCAL UPDATE: Remove from local array and redraw table instantly
    // This ensures the UI updates immediately even if server refresh is delayed
    const originalLength = largeInventory.length;
    largeInventory = largeInventory.filter(item => item.id !== pendingDeleteId);
    const newLength = largeInventory.length;
    
    console.log(`Local inventory updated: ${originalLength} → ${newLength} items`);
    console.log('Remaining IDs:', largeInventory.map(i => i.id));
    
    // Force immediate redraw of the table with updated data
    displayLargeInventory(largeInventory);
    updateStats();
    updateInventoryBadge();
    
    showToast('Item deleted successfully', 'success');
    closeDeleteConfirmModal();
    
    // Background server refresh to ensure full sync (with small delay)
    setTimeout(() => {
      console.log('Running background sync with server...');
      loadLargeInventory();
    }, 800);
    
  } catch (err) {
    console.error('Delete operation failed:', err);
    showToast('Error deleting item: ' + err.message, 'critical');
  } finally {
    // Reset button state
    elements.confirmDeleteBtn.innerHTML = originalBtnContent;
    elements.confirmDeleteBtn.disabled = false;
  }
}

function closeAllModals() {
  elements.largeModal.style.display = 'none';
  elements.quickAddModal.style.display = 'none';
  elements.lookupModal.style.display = 'none';
  elements.signOutModal.style.display = 'none';
  elements.deleteConfirmModal.style.display = 'none';
}

// ============================================
// Save Functions - USING STORAGE SUPABASE CLIENT
// ============================================

async function saveLargeItem() {
  const id = elements.itemId.value;
  const barcode = elements.barcode.value.trim();
  const boxName = elements.boxName.value.trim();
  const quantity = parseInt(elements.quantity.value) || 0;
  const expDate = elements.expDate.value;
  const notes = elements.notes.value.trim();

  if (!boxName) {
    showToast('Please enter a box name', 'warning');
    return;
  }

  const itemData = {
    barcode: barcode || null,
    box_name: boxName,
    quantity: quantity,
    expiration_date: expDate || null,
    notes: notes || null,
    updated_at: new Date().toISOString()
  };

  let error;
  if (id) {
    // Update existing item using storageSupabaseClient
    const result = await storageSupabaseClient
      .from('large_inventory')
      .update(itemData)
      .eq('id', parseInt(id, 10));  // Ensure ID is integer
    error = result.error;
  } else {
    // Insert new item using storageSupabaseClient
    itemData.created_at = new Date().toISOString();
    const result = await storageSupabaseClient
      .from('large_inventory')
      .insert([itemData]);
    error = result.error;
  }

  if (error) {
    showToast('Error saving item: ' + error.message, 'critical');
  } else {
    showToast('Saved to data successfully', 'success');
    closeLargeModal();
    loadLargeInventory();
  }
}

async function saveQuickAdd() {
  const barcode = elements.quickBarcode.value;
  const boxName = elements.quickBoxName.value.trim();
  const quantity = parseInt(elements.quickQuantity.value) || 1;
  const expDate = elements.quickExpDate.value;
  
  if (!boxName) {
    showToast('Please enter a box name', 'warning');
    return;
  }
  
  const itemData = {
    barcode: barcode || null,
    box_name: boxName,
    quantity: quantity,
    expiration_date: expDate || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  // Use storageSupabaseClient from shared-data.js
  const { error } = await storageSupabaseClient
    .from('large_inventory')
    .insert([itemData]);
  
  if (error) {
    showToast('Error adding item: ' + error.message, 'critical');
  } else {
    showScanFeedback('success', `Added: ${boxName}`);
    closeQuickAddModal();
    loadLargeInventory();
    elements.lastScanAction.innerHTML = '<span style="color: #32cd32;"><i class="fa-solid fa-check"></i> New item added</span>';
  }
}

// ============================================
// DEPRECATED: Old Delete Function
// No longer used - UI now uses confirmation modal flow
// ============================================

/**
 * @deprecated Use showDeleteConfirmModal() + confirmDeleteItem() instead
 * This function is kept for emergency use only but should not be called from UI
 */
async function deleteLargeItem(id) {
  console.warn('deleteLargeItem() is deprecated. Use the confirmation modal flow instead.');
  
  // If called directly, redirect to the modal flow
  if (id) {
    const item = largeInventory.find(i => i.id === parseInt(id, 10));
    const boxName = item ? item.box_name : 'Unknown Item';
    showDeleteConfirmModal(id, boxName);
    return;
  }
  
  showToast('Please use the delete button in the table', 'warning');
}

// ============================================
// Barcode Lookup Result
// ============================================

function lookupBarcode(barcode) {
  if (!barcode) {
    showToast('No barcode provided', 'warning');
    return;
  }
  
  const items = largeInventory.filter(item => item.barcode === barcode);
  const resultDiv = document.getElementById('lookupResult');
  
  if (items.length === 0) {
    resultDiv.innerHTML = `
      <div class="lookup-result empty">
        <i class="fa-solid fa-circle-question"></i>
        <p>No items found with barcode: <strong>${barcode}</strong></p>
      </div>
    `;
  } else {
    let html = `
      <div class="lookup-result success">
        <i class="fa-solid fa-circle-check"></i>
        <p>Found ${items.length} item(s):</p>
      </div>
    `;
    
    items.forEach(item => {
      html += `
        <div class="lookup-item">
          <div class="lookup-item-header">
            <i class="fa-solid fa-box"></i>
            <strong>${item.box_name}</strong>
          </div>
          <div class="lookup-item-details">
            <span><i class="fa-solid fa-hashtag"></i> Quantity: ${item.quantity}</span>
            <span><i class="fa-solid fa-calendar"></i> Expires: ${item.expiration_date || 'N/A'}</span>
          </div>
        </div>
      `;
    });
    
    resultDiv.innerHTML = html;
  }
  
  elements.lookupModal.style.display = 'block';
}

// ============================================
// Sign Out Functions
// ============================================

async function performSignOut() {
  if (typeof logoutAdmin === 'function') {
    await logoutAdmin();
  } else {
    window.location.href = 'login.html';
  }
}

// ============================================
// Toast Notification
// ============================================

function showToast(message, type = 'success') {
  let toast = elements.storageToast;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'storageToast';
    toast.className = 'toast';
    toast.innerHTML = '<i class="fas fa-check-circle"></i><span id="toastMessage"></span>';
    document.body.appendChild(toast);
  }
  
  const toastMessage = toast.querySelector('#toastMessage') || toast.querySelector('span');
  const toastIcon = toast.querySelector('i');
  
  toastMessage.textContent = message;
  toast.className = 'toast';
  
  if (type === 'critical') {
    toast.classList.add('critical');
    toastIcon.className = 'fas fa-exclamation-circle';
  } else if (type === 'warning') {
    toast.classList.add('warning');
    toastIcon.className = 'fas fa-exclamation-triangle';
  } else {
    toastIcon.className = 'fas fa-check-circle';
  }
  
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}