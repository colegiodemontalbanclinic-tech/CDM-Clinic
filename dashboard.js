/**
 * School Clinic Dashboard - Database Version
 * Connected to Supabase for patient data
 * With live INVENTORY stock data from large_inventory table
 * UPDATED: Vital sign color coding for patient status badges
 * UPDATED: Critical inventory items only filter with matching row heights
 * UPDATED: Removed notes from inventory, copied status badge design to expiry badges, fixed row heights
 */

// ============================================
// DOM Elements
// ============================================
const elements = {
    dateTime: document.getElementById('dateTime'),
    totalPatients: document.getElementById('totalPatients'),
    stablePatients: document.getElementById('stablePatients'),
    unstablePatients: document.getElementById('unstablePatients'),
    queueInfo: document.getElementById('queueInfo'),
    queuePercent: document.getElementById('queuePercent'),
    progressFill: document.getElementById('progressFill'),
    queueStatusDetail: document.getElementById('queueStatusDetail'),
    patientTable: document.getElementById('patientTable'),
    medicineTable: document.getElementById('medicineTable'),
    summaryContent: document.getElementById('summaryContent'),
    alerts: document.getElementById('alerts'),
    alertCount: document.getElementById('alertCount'),
    stockBadge: document.getElementById('stockBadge'),
    dismissBtn: document.getElementById('dismissAll'),
    refreshPatientsBtn: document.getElementById('refreshPatients'),
    refreshMedicineBtn: document.getElementById('refreshMedicine'),
    signOutBtn: document.getElementById('signOutBtn'),
    signOutModal: document.getElementById('signOutModal'),
    cancelSignOut: document.getElementById('cancelSignOut'),
    confirmSignOut: document.getElementById('confirmSignOut'),
    dashboardLoading: document.getElementById('dashboardLoading'),
    alertsCard: document.getElementById('alertsCard'),
    tablesGrid: document.getElementById('tablesGrid'),
    summaryCard: document.getElementById('summaryCard')
};

// Inventory Data - now loaded from large_inventory table
let inventoryItems = [];
let inventoryChannel = null;
let inventoryLoadRetries = 0;
const MAX_INVENTORY_RETRIES = 3;

// Alert tracking flags
let inventoryAlertsShown = {
    expired: false,
    nearExpiry: false,
    lowStock: false
};

// ============================================
// Initialize Dashboard
// ============================================
async function initDashboard() {
    console.log('Initializing dashboard with Storage integration...');
    console.log('Current Philippine Date:', getTodayDate());

    // Start clock immediately using shared-data.js PH time function
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Show loading state
    showDashboardLoading(true);

    // Load patient data from database
    const patientsLoaded = await loadPatientsFromDB();

    // Load inventory data from large_inventory table with retry logic
    const inventoryLoaded = await loadInventoryFromDB();
    if (inventoryLoaded) {
        initInventoryRealtime();
    }

    if (patientsLoaded) {
        console.log(`Loaded ${patientsData.length} patients and ${inventoryItems.length} inventory items`);
        showDashboardLoading(false);
        renderAll();
    } else {
        console.error('Failed to load patients');
        showDashboardLoading(false);
        showErrorState('Failed to load data. Please refresh.');
    }

    // Backup polling every 2 minutes
    setInterval(async () => {
        console.log('Backup sync check...');
        await loadPatientsFromDB();
        renderAll();
    }, 120000); // 2 minutes

    // Event Listeners
    setupEventListeners();
}

function showDashboardLoading(show) {
    if (elements.dashboardLoading) {
        elements.dashboardLoading.style.display = show ? 'block' : 'none';
    }
    if (elements.alertsCard) {
        elements.alertsCard.style.display = show ? 'none' : 'block';
    }
    if (elements.tablesGrid) {
        elements.tablesGrid.style.display = show ? 'none' : 'grid';
    }
    if (elements.summaryCard) {
        elements.summaryCard.style.display = show ? 'none' : 'block';
    }
}

function showErrorState(message) {
    if (elements.alerts) {
        elements.alerts.innerHTML = `<li class="alert-item critical"><i class="fa-solid fa-circle-exclamation"></i> ${message}</li>`;
    }
    if (elements.alertsCard) {
        elements.alertsCard.style.display = 'block';
    }
    updateAlertsScroll();
}

function renderAll() {
    renderPatients();
    renderInventory();
    generateSummary();
}

function setupEventListeners() {
    if (elements.dismissBtn) elements.dismissBtn.addEventListener('click', dismissAllAlerts);
    if (elements.refreshPatientsBtn) elements.refreshPatientsBtn.addEventListener('click', () => refreshData('patients'));
    if (elements.refreshMedicineBtn) elements.refreshMedicineBtn.addEventListener('click', () => refreshData('inventory'));

    // Sign Out Modal
    if (elements.signOutBtn) elements.signOutBtn.addEventListener('click', showSignOutModal);
    if (elements.cancelSignOut) elements.cancelSignOut.addEventListener('click', closeSignOutModal);
    if (elements.confirmSignOut) elements.confirmSignOut.addEventListener('click', performSignOut);

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target === elements.signOutModal) closeSignOutModal();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.signOutModal && elements.signOutModal.style.display === 'block') {
            closeSignOutModal();
        }
    });

    // Refresh on window focus
    window.addEventListener('focus', async () => {
        console.log('Window focused, refreshing data...');
        console.log('Philippine Date:', getTodayDate());
        await refreshData('patients');
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (inventoryChannel) {
            inventoryChannel.unsubscribe();
        }
    });
}

// ============================================
// ALERTS SCROLL FUNCTIONALITY
// ============================================

function updateAlertsScroll() {
    if (!elements.alerts) return;

    const alertItems = elements.alerts.querySelectorAll('.alert-item');

    elements.alerts.classList.remove('has-scroll');

    if (alertItems.length > 2) {
        elements.alerts.classList.add('has-scroll');
    }
}

// ============================================
// INVENTORY DATA FROM LARGE_INVENTORY TABLE (SUPABASE)
// ============================================

async function loadInventoryFromDB() {
    console.log('Loading inventory from large_inventory table...');

    // Check storage client is available
    if (!storageSupabaseClient) {
        console.error('Storage Supabase client not initialized');
        showToast('Storage database not connected', 'critical');
        return false;
    }

    for (let attempt = 0; attempt <= MAX_INVENTORY_RETRIES; attempt++) {
        if (attempt > 0) {
            console.log(`Retrying... Attempt ${attempt}/${MAX_INVENTORY_RETRIES}`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }

        try {
            // Use storageSupabaseClient to query large_inventory table
            const { data, error } = await storageSupabaseClient
                .from('large_inventory')
                .select('*')
                .order('id', { ascending: true });

            if (!error) {
                // Success - reset retry counter
                inventoryLoadRetries = 0;

                if (!data || data.length === 0) {
                    console.log('No items found in large_inventory');
                    inventoryItems = [];
                    return true;
                }

                // Map large_inventory fields to frontend format
                inventoryItems = data.map(item => ({
                    id: item.id,
                    name: item.box_name,
                    qty: item.quantity || 0,
                    expiryDate: item.expiration_date,
                    status: getInventoryStockStatus(item.quantity)
                }));

                console.log(`Loaded ${inventoryItems.length} items from large_inventory`);
                return true;
            }

            console.error('Failed to load inventory:', error);

        } catch (err) {
            console.error('Exception loading inventory:', err);
        }
    }

    // All retries exhausted
    showToast('Failed to load inventory data', 'critical');
    inventoryItems = [];
    return false;
}

function initInventoryRealtime() {
    if (inventoryChannel) {
        inventoryChannel.unsubscribe();
    }

    // Use storageSupabaseClient to subscribe to large_inventory changes
    inventoryChannel = storageSupabaseClient
        .channel('dashboard-large-inventory')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'large_inventory'
        }, (payload) => {
            console.log('Large inventory changed:', payload);
            handleInventoryChange(payload);
        })
        .subscribe((status) => {
            console.log('Large inventory realtime status:', status);
            if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to large_inventory changes');
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.error('Large inventory subscription issue:', status);
                setTimeout(() => initInventoryRealtime(), 5000);
            }
        });
}

function handleInventoryChange(payload) {
    try {
        const { eventType, new: newRecord, old: oldRecord } = payload;

        switch(eventType) {
            case 'INSERT':
                inventoryItems.push({
                    id: newRecord.id,
                    name: newRecord.box_name,
                    qty: newRecord.quantity || 0,
                    expiryDate: newRecord.expiration_date,
                    status: getInventoryStockStatus(newRecord.quantity)
                });
                break;

            case 'UPDATE':
                const index = inventoryItems.findIndex(item => item.id === oldRecord.id);
                if (index !== -1) {
                    inventoryItems[index] = {
                        id: newRecord.id,
                        name: newRecord.box_name,
                        qty: newRecord.quantity || 0,
                        expiryDate: newRecord.expiration_date,
                        status: getInventoryStockStatus(newRecord.quantity)
                    };
                }
                break;

            case 'DELETE':
                inventoryItems = inventoryItems.filter(item => item.id !== oldRecord.id);
                break;
        }

        renderInventory();
        generateSummary();

        const itemName = newRecord?.box_name || oldRecord?.box_name;
        if (eventType === 'UPDATE' && itemName) {
            showToast(`${itemName} stock updated: ${newRecord.quantity} units`, 'success');
        }
    } catch (err) {
        console.error('Error handling inventory change:', err);
    }
}

// ============================================
// Clock - Philippine Time Display (REALTIME)
// ============================================
function updateDateTime() {
    // Use getPhilippineTimestamp from shared-data.js for accurate PH time
    const timestamp = getPhilippineTimestamp();

    if (elements.dateTime) {
        elements.dateTime.textContent = `${timestamp.date} | ${timestamp.time}`;
    }
}

// ============================================
// Patient Data Rendering - VITAL SIGNS COLOR CODING
// ============================================
function renderPatients() {
    // Get today's patients using Philippine Time from shared-data.js
    const today = getTodayDate();
    let todayPatients = [];

    if (typeof getTodayPatients === 'function') {
        todayPatients = getTodayPatients();
    } else {
        // Fallback if getTodayPatients is not available
        todayPatients = patientsData.filter(p => p.date === today);
    }

    console.log(`Rendering patients for ${today}:`, todayPatients.length, 'patients');

    // Get registration stats
    let regStats = { total: 0, registered: 0, pending: 0, percentComplete: 0 };
    if (typeof getPatientRegistrationStats === 'function') {
        regStats = getPatientRegistrationStats();
    } else {
        // Fallback calculation
        const total = todayPatients.length;
        const registered = todayPatients.filter(p => p.name && p.name.trim().length > 0).length;
        regStats = {
            total,
            registered,
            pending: total - registered,
            percentComplete: total > 0 ? Math.round((registered / total) * 100) : 0
        };
    }

    const stableCount = todayPatients.filter(p => p.status === 'stable').length;
    const unstableCount = todayPatients.filter(p => p.status === 'unstable').length;

    // Update stat cards
    elements.totalPatients.textContent = todayPatients.length;
    elements.stablePatients.textContent = stableCount;
    elements.unstablePatients.textContent = unstableCount;

    updateQueueProgress(regStats);

    // Clear and render table
    elements.patientTable.innerHTML = '';

    if (todayPatients.length === 0) {
        const row = document.createElement('tr');
        row.style.height = '48px';
        row.innerHTML = `
            <td colspan="4" style="text-align: center; padding: 0 8px; color: rgba(255,255,255,0.6); height: 48px; line-height: 48px;">
                <i class="fa-solid fa-inbox" style="margin-right: 8px; font-size: 1.2rem;"></i>
                No patients today (${today})
            </td>
        `;
        elements.patientTable.appendChild(row);
    } else {
        // Sort by hashtag number (001-999) for consistent ordering
        todayPatients = sortPatientsByHashtag(todayPatients);

        todayPatients.forEach((patient, index) => {
            const row = document.createElement('tr');
            const isStable = patient.status === 'stable';

            // Check registration status
            let isRegistered = false;
            if (typeof hasPatientBeenRegistered === 'function') {
                isRegistered = hasPatientBeenRegistered(patient);
            } else {
                isRegistered = patient.name && patient.name.trim().length > 0;
            }

            // Add row class for background coloring based on vital signs
            if (isStable) {
                row.classList.add('stable-row');
            } else {
                row.classList.add('unstable-row');
            }

            row.style.cursor = 'pointer';
            row.onclick = () => viewPatientInHistory(patient.id);

            const registrationCell = isRegistered ? 
                '<span class="reg-icon registered" title="Registered"><i class="fa-solid fa-check"></i></span>' : 
                '<span class="reg-icon unregistered" title="Not Registered"><i class="fa-solid fa-xmark"></i></span>';

            // Use formatHashtag for consistent 3-digit display
            const formattedHashtag = formatHashtag(patient.hashtag);

            // UPDATED: Use vital sign color coding for status badges
            const badgeClass = isStable ? 'stable' : 'unstable';
            const iconClass = isStable ? 'check' : 'exclamation';
            const statusText = isStable ? 'Stable' : 'Unstable';

            row.innerHTML = `
                <td><strong>${formattedHashtag}</strong></td>
                <td>${patient.time}</td>
                <td style="text-align: center;">${registrationCell}</td>
                <td style="text-align: center;">
                    <span class="status-badge ${badgeClass}">
                        <i class="fa-solid fa-${iconClass}-circle"></i>
                        ${statusText}
                    </span>
                </td>
            `;

            row.addEventListener('mouseenter', () => {
                row.style.background = 'rgba(50, 205, 50, 0.15)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = '';
            });

            row.style.opacity = '0';
            row.style.animation = `slideDown 0.3s ease ${index * 0.05}s forwards`;
            elements.patientTable.appendChild(row);
        });
    }
}

function updateQueueProgress(regStats) {
    const { total, registered, pending, percentComplete } = regStats;

    elements.queueInfo.textContent = `${registered} of ${total} registered`;
    elements.queuePercent.textContent = `${percentComplete}%`;
    elements.progressFill.style.width = `${percentComplete}%`;

    if (elements.queueStatusDetail) {
        if (total === 0) {
            elements.queueStatusDetail.textContent = 'No patients in queue';
            elements.queueStatusDetail.style.color = 'rgba(255,255,255, 1)';
        } else if (pending === 0) {
            elements.queueStatusDetail.textContent = 'All patients registered! ✓';
            elements.queueStatusDetail.style.color = 'rgba(255, 255, 255, 1)';
        } else if (pending === 1) {
            elements.queueStatusDetail.textContent = '1 patient needs registration';
            elements.queueStatusDetail.style.color = '#FFD700';
        } else {
            elements.queueStatusDetail.textContent = `${pending} patients need registration`;
            elements.queueStatusDetail.style.color = '#FFD700';
        }
    }

    if (percentComplete === 100) {
        elements.progressFill.style.background = 'linear-gradient(90deg, rgba(50, 205, 50, 0.9), rgba(144, 238, 144, 0.9))';
    } else if (percentComplete >= 50) {
        elements.progressFill.style.background = 'linear-gradient(90deg, rgba(218, 165, 32, 0.9), rgba(255, 215, 0, 0.9))';
    } else {
        elements.progressFill.style.background = 'linear-gradient(90deg, rgba(220, 20, 60, 0.9), rgba(255, 69, 0, 0.9))';
    }
}

// ============================================
// INVENTORY STOCK RENDERING - CRITICAL ITEMS ONLY
// UPDATED: Removed notes, copied status badge design, fixed row heights
// ============================================
function renderInventory() {
    const tableBody = document.getElementById('medicineTable');
    if (!tableBody) {
        console.error('Inventory table body not found');
        return { lowCount: 0, mediumCount: 0, expiredCount: 0, nearExpiryCount: 0 };
    }

    let lowCount = 0, mediumCount = 0, expiredCount = 0, nearExpiryCount = 0;

    tableBody.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ============================================
    // FILTER: Only show critical items
    // ============================================
    const criticalItems = inventoryItems.filter(item => {
        const expiryInfo = getInventoryExpiryStatus(item.expiryDate, today);
        
        // Check if item is critical:
        // 1. Expired
        // 2. Near expiry (≤7 days)
        // 3. Low stock (≤5) or zero stock
        const isExpired = expiryInfo.status === 'expired';
        const isNearExpiry = expiryInfo.status === 'near';
        const isLowStock = item.qty === null || item.qty === undefined || item.qty === 0 || item.qty <= 5;
        
        return isExpired || isNearExpiry || isLowStock;
    });

    // Sort critical items: expired first, then near expiry, then low stock
    const sortedInventory = [...criticalItems].sort((a, b) => {
        const aExpiry = getInventoryExpiryStatus(a.expiryDate, today);
        const bExpiry = getInventoryExpiryStatus(b.expiryDate, today);

        const priority = {
            'expired': 0,
            'near': 1,
            'unknown': 2,
            'good': 3
        };

        // First sort by expiry priority
        if (priority[aExpiry.status] !== priority[bExpiry.status]) {
            return priority[aExpiry.status] - priority[bExpiry.status];
        }

        // Then by stock level (zero stock first, then low stock)
        if ((a.qty === 0 || a.qty === null) && (b.qty !== 0 && b.qty !== null)) return -1;
        if ((b.qty === 0 || b.qty === null) && (a.qty !== 0 && a.qty !== null)) return 1;
        if (a.qty <= 5 && b.qty > 5) return -1;
        if (b.qty <= 5 && a.qty > 5) return 1;

        // Finally by ID
        return a.id - b.id;
    });

    // Update counts based on ALL inventory (for alerts and summary)
    inventoryItems.forEach(item => {
        const expiryInfo = getInventoryExpiryStatus(item.expiryDate, today);
        
        if (expiryInfo.status === 'expired') expiredCount++;
        else if (expiryInfo.status === 'near') nearExpiryCount++;
        
        if (item.qty === null || item.qty === undefined || item.qty === 0 || item.qty <= 5) {
            lowCount++;
        } else if (item.qty <= 15) {
            mediumCount++;
        }
    });

    // ============================================
    // RENDER: Critical items only
    // ============================================
    if (sortedInventory.length === 0) {
        const row = document.createElement('tr');
        row.style.height = '48px';
        row.innerHTML = `
            <td colspan="3" style="text-align: center; padding: 0 8px; color: rgba(255,255,255,0.6); height: 48px; line-height: 48px;">
                <i class="fa-solid fa-check-circle" style="margin-right: 8px; font-size: 1.2rem; color: #32cd32;"></i>
                All items healthy — No critical stock issues
            </td>
        `;
        tableBody.appendChild(row);
        
        updateStockBadge(lowCount, mediumCount, expiredCount, nearExpiryCount);
        return { lowCount, mediumCount, expiredCount, nearExpiryCount };
    }

    sortedInventory.forEach((item, index) => {
        const row = document.createElement('tr');
        row.dataset.itemId = item.id;
        // FIXED: Strict 48px row height
        row.style.height = '48px';

        const expiryInfo = getInventoryExpiryStatus(item.expiryDate, today);

        if (expiryInfo.status === 'expired') {
            row.classList.add('expired-row');
        } else if (expiryInfo.status === 'near') {
            row.classList.add('near-expiry-row');
        }

        // Qty color coding
        const qtyColor = item.qty === 0 ? '#FFFFFF' : (item.qty <= 5 ? '#FFFFFF' : '#FFFFFF');

        // UPDATED: Removed notes, item name only
        row.innerHTML = `
            <td><strong>${item.name}</strong></td>
            <td style="color: ${qtyColor}; font-weight: 600;">${item.qty !== null ? item.qty : 0}</td>
            <td>${expiryInfo.badge}</td>
        `;

        // UPDATED: Tooltip without notes
        row.title = `ID: #${item.id} | ${item.name} | Qty: ${item.qty} | ${expiryInfo.text}`;

        // Make row clickable to navigate to storage page
        row.style.cursor = 'pointer';
        row.onclick = () => viewItemInStorage(item.id);

        // Hover effects matching patient table
        row.addEventListener('mouseenter', () => {
            row.style.background = 'rgba(50, 205, 50, 0.15)';
        });
        row.addEventListener('mouseleave', () => {
            row.style.background = '';
        });

        // Animation
        row.style.opacity = '0';
        row.style.animation = `slideDown 0.3s ease ${index * 0.05}s forwards`;
        tableBody.appendChild(row);
    });

    updateStockBadge(lowCount, mediumCount, expiredCount, nearExpiryCount);
    showInventoryAlerts(expiredCount, nearExpiryCount, lowCount);

    return { lowCount, mediumCount, expiredCount, nearExpiryCount };
}

function updateStockBadge(lowCount, mediumCount, expiredCount, nearExpiryCount) {
    const badge = elements.stockBadge;
    if (!badge) {
        console.error('Stock badge element not found');
        return;
    }

    // Priority: Expired > Near Expiry > Low Stock > Medium > Good
    if (expiredCount > 0) {
        badge.textContent = `${expiredCount} Expired`;
        badge.style.background = 'rgba(220, 20, 60, 0.6)';
        badge.style.color = '#ff9f9f';
    } else if (nearExpiryCount > 0) {
        badge.textContent = `${nearExpiryCount} Expiring`;
        badge.style.background = 'rgba(255, 193, 7, 0.3)';
        badge.style.color = '#FFD700';
    } else if (lowCount > 0) {
        badge.textContent = `${lowCount} Low Stock`;
        badge.style.background = 'rgba(139, 0, 0, 0.6)';
        badge.style.color = '#ff9f9f';
    } else if (mediumCount > 0) {
        badge.textContent = 'Medium Stock';
        badge.style.background = 'rgba(218, 165, 32, 0.3)';
        badge.style.color = '#FFD700';
    } else {
        badge.textContent = 'All Healthy';
        badge.style.background = 'rgba(0, 128, 0, 0.6)';
        badge.style.color = 'rgba(144, 238, 144, 1)';
    }
}

function showInventoryAlerts(expired, nearExpiry, lowStock) {
    // Only show each alert type once per session
    if (expired > 0 && !inventoryAlertsShown.expired) {
        addAlert('critical', 'fa-solid fa-calendar-xmark', 
            `${expired} item(s) have EXPIRED! Check storage immediately.`);
        inventoryAlertsShown.expired = true;
    }
    if (nearExpiry > 0 && !inventoryAlertsShown.nearExpiry) {
        addAlert('warning', 'fa-solid fa-clock', 
            `${nearExpiry} item(s) expiring within 7 days.`);
        inventoryAlertsShown.nearExpiry = true;
    }
    if (lowStock > 0 && !inventoryAlertsShown.lowStock) {
        addAlert('warning', 'fa-solid fa-box-open', 
            `${lowStock} item(s) running low on stock (5 or fewer).`);
        inventoryAlertsShown.lowStock = true;
    }
}

function addAlert(type, iconClass, message) {
    const alert = document.createElement('li');
    alert.className = `alert-item ${type}`;
    alert.innerHTML = `<i class="${iconClass}"></i> ${message}`;
    alert.style.animation = 'slideDown 0.4s ease';

    if (elements.alerts) {
        elements.alerts.appendChild(alert);
        updateAlertsScroll();

        const currentCount = parseInt(elements.alertCount.textContent) || 0;
        elements.alertCount.textContent = currentCount + 1;
    }
}

// ============================================
// Generate Summary & Alerts
// ============================================
function generateSummary() {
    // Get today's patients using Philippine Time
    let todayPatients = [];
    if (typeof getTodayPatients === 'function') {
        todayPatients = getTodayPatients();
    } else {
        const today = getTodayDate();
        todayPatients = patientsData.filter(p => p.date === today);
    }

    let regStats = { registered: 0, pending: 0 };
    if (typeof getPatientRegistrationStats === 'function') {
        regStats = getPatientRegistrationStats();
    } else {
        const total = todayPatients.length;
        const registered = todayPatients.filter(p => p.name && p.name.trim().length > 0).length;
        regStats = { registered, pending: total - registered };
    }

    const inventoryStats = renderInventory();

    const stableCount = todayPatients.filter(p => p.status === 'stable').length;
    const unstableCount = todayPatients.filter(p => p.status === 'unstable').length;
    const alertCount = unstableCount + inventoryStats.lowCount + inventoryStats.expiredCount;

    elements.alertCount.textContent = alertCount;
    elements.alertCount.style.background = alertCount === 0
        ? 'linear-gradient(135deg, rgba(0, 128, 0, 0.9), rgba(50, 205, 50, 0.9))'
        : 'linear-gradient(135deg, rgba(220, 20, 60, 0.9), rgba(255, 69, 0, 0.9))';

    elements.summaryContent.innerHTML = `
        <div class="summary-item">
            <div class="summary-number" style="color: rgba(144, 238, 144, 1);">${todayPatients.length}</div>
            <div class="summary-label">Total Patients</div>
        </div>
        <div class="summary-item">
            <div class="summary-number" style="color: rgba(144, 238, 144, 1);">${regStats.registered}</div>
            <div class="summary-label">Registered</div>
        </div>
        <div class="summary-item">
            <div class="summary-number" style="color: ${regStats.pending > 0 ? '#FFD700' : 'rgba(144, 238, 144, 1)'}">${regStats.pending}</div>
            <div class="summary-label">Pending Reg</div>
        </div>
        <div class="summary-item">
            <div class="summary-number" style="color: rgba(144, 238, 144, 1);">${stableCount}</div>
            <div class="summary-label">Stable</div>
        </div>
        <div class="summary-item">
            <div class="summary-number" style="color: #ff6b6b;">${unstableCount}</div>
            <div class="summary-label">Unstable</div>
        </div>
        <div class="summary-item">
            <div class="summary-number" style="color: ${inventoryStats.lowCount > 0 || inventoryStats.expiredCount > 0 ? '#ff6b6b' : 'rgba(144, 238, 144, 1)'}">${inventoryStats.lowCount + inventoryStats.expiredCount}</div>
            <div class="summary-label">Inventory Alerts</div>
        </div>
    `;

    renderAlerts(unstableCount, inventoryStats, todayPatients);
}

function renderAlerts(unstableCount, inventoryStats, patients) {
    elements.alerts.innerHTML = '';

    if (unstableCount === 0 && inventoryStats.lowCount === 0 && inventoryStats.expiredCount === 0) {
        const alert = document.createElement('li');
        alert.className = 'alert-item success';
        alert.innerHTML = `<i class="fa-solid fa-shield-check"></i> All systems operational - No issues detected`;
        elements.alerts.appendChild(alert);
        updateAlertsScroll();
        return;
    }

    if (unstableCount > 0 && patients) {
        const unstablePatients = patients.filter(p => p.status === 'unstable');

        unstablePatients.forEach(patient => {
            const alert = document.createElement('li');
            alert.className = 'alert-item critical';

            let vitalDetails = '';
            if (patient.stabilityReason) {
                vitalDetails = `<div style="font-size:0.8rem;opacity:0.9;margin-top:4px;">${patient.stabilityReason}</div>`;
            }

            // Use formatHashtag for consistent 3-digit display
            const formattedHashtag = formatHashtag(patient.hashtag);

            alert.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div>
                    <strong>${formattedHashtag} - ${patient.name || 'Unknown'}</strong>
                    <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Unstable patient requires attention</div>
                    ${vitalDetails}
                </div>
            `;

            alert.style.cursor = 'pointer';
            alert.onclick = () => viewPatientInHistory(patient.id);
            elements.alerts.appendChild(alert);
        });
    }

    if (inventoryStats.expiredCount > 0) {
        const expiredItems = inventoryItems.filter(item => {
            const expiry = getInventoryExpiryStatus(item.expiryDate, new Date());
            return expiry.status === 'expired';
        });
        
        expiredItems.forEach(item => {
            const alert = document.createElement('li');
            alert.className = 'alert-item critical';
            alert.innerHTML = `
                <i class="fa-solid fa-calendar-xmark"></i>
                <div>
                    <strong>${item.name} - EXPIRED</strong>
                    <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Immediate action required</div>
                </div>
            `;
            alert.style.cursor = 'pointer';
            alert.onclick = () => viewItemInStorage(item.id);
            elements.alerts.appendChild(alert);
        });
    }

    if (inventoryStats.nearExpiryCount > 0) {
        const nearExpiryItems = inventoryItems.filter(item => {
            const expiry = getInventoryExpiryStatus(item.expiryDate, new Date());
            return expiry.status === 'near';
        });
        
        nearExpiryItems.forEach(item => {
            const alert = document.createElement('li');
            alert.className = 'alert-item warning';
            alert.innerHTML = `
                <i class="fa-solid fa-clock"></i>
                <div>
                    <strong>${item.name} - Expiring Soon</strong>
                    <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Within 7 days - Plan restocking</div>
                </div>
            `;
            alert.style.cursor = 'pointer';
            alert.onclick = () => viewItemInStorage(item.id);
            elements.alerts.appendChild(alert);
        });
    }

    if (inventoryStats.lowCount > 0) {
        const lowStockItems = inventoryItems.filter(item => item.qty <= 5);
        
        lowStockItems.forEach(item => {
            const alert = document.createElement('li');
            alert.className = 'alert-item warning';
            alert.innerHTML = `
                <i class="fa-solid fa-box-open"></i>
                <div>
                    <strong>${item.name} - Low Stock</strong>
                    <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Only ${item.qty} unit(s) remaining</div>
                </div>
            `;
            alert.style.cursor = 'pointer';
            alert.onclick = () => viewItemInStorage(item.id);
            elements.alerts.appendChild(alert);
        });
    }

    updateAlertsScroll();
}

// ============================================
// Navigation
// ============================================
function viewPatientInHistory(patientId) {
    window.location.href = `history.html?patientId=${patientId}`;
}

function viewItemInStorage(itemId) {
    // Navigate to storage page with item ID parameter
    window.location.href = `storage.html?itemId=${itemId}&focus=true`;
}

// ============================================
// Refresh Data (FIXED)
// ============================================
async function refreshData(type) {
    const btn = type === 'patients' ? elements.refreshPatientsBtn : elements.refreshMedicineBtn;

    if (btn) btn.classList.add('refreshing');

    if (type === 'patients') {
        const loaded = await loadPatientsFromDB();
        if (loaded) {
            renderAll();
            showToast('Patient data refreshed');
        } else {
            showToast('Failed to refresh patient data', 'critical');
        }
    } else {
        inventoryLoadRetries = 0; // Reset retries
        const loaded = await loadInventoryFromDB();
        if (loaded) {
            renderInventory();
            generateSummary();
            showToast('Inventory stock refreshed');
        } else {
            showToast('Failed to refresh inventory data', 'critical');
        }
    }

    setTimeout(() => {
        if (btn) btn.classList.remove('refreshing');
    }, 500);
}

// ============================================
// Dismiss Alerts
// ============================================
function dismissAllAlerts() {
    const alertItems = elements.alerts.querySelectorAll('.alert-item');
    alertItems.forEach((item, index) => {
        setTimeout(() => {
            item.style.animation = 'slideUp 0.3s ease forwards';
        }, index * 100);
    });

    setTimeout(() => {
        elements.alerts.innerHTML = '<li class="alert-item success"><i class="fa-solid fa-check"></i> Alerts dismissed - Dashboard refreshed</li>';
        elements.alertCount.textContent = '0';
        elements.alertCount.style.background = 'linear-gradient(135deg, rgba(0, 128, 0, 0.9), rgba(50, 205, 50, 0.9))';
        updateAlertsScroll();
    }, alertItems.length * 100 + 300);
}

// ============================================
// Sign Out Modal
// ============================================
function showSignOutModal(e) {
    if (e) e.preventDefault();
    if (elements.signOutModal) {
        elements.signOutModal.style.display = 'block';
    }
}

function closeSignOutModal() {
    if (elements.signOutModal) {
        elements.signOutModal.style.display = 'none';
    }
}

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
    let toast = document.getElementById('dashboardToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dashboardToast';
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

// ============================================
// DEBUG FUNCTION
// ============================================

/**
 * Debug function to check dashboard data
 * Call in browser console: debugDashboard()
 */
function debugDashboard() {
    console.group('=== DASHBOARD DEBUG ===');
    console.log('Philippine Date:', getTodayDate());
    console.log('Browser Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Total patients in memory:', patientsData.length);

    const today = getTodayDate();
    const todayPatients = patientsData.filter(p => p.date === today);
    console.log(`Today's patients (${today}):`, todayPatients.length);

    if (todayPatients.length > 0) {
        console.log('Patient list (sorted by hashtag):');
        // Sort by hashtag for debug output
        const sortedPatients = sortPatientsByHashtag([...todayPatients]);
        sortedPatients.forEach(p => {
            console.log(`  - ${formatHashtag(p.hashtag)}: ${p.name || '(unregistered)'} at ${p.time}, status: ${p.status}`);
        });
    } else {
        const uniqueDates = [...new Set(patientsData.map(p => p.date))].sort().slice(-5);
        console.log('Last 5 patient dates in DB:', uniqueDates);
    }

    console.groupEnd();
    return todayPatients;
}

// ============================================
// Initialize on DOM Ready
// ============================================
document.addEventListener('DOMContentLoaded', initDashboard);