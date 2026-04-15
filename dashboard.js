/**
 * School Clinic Dashboard - Database Version with Pi Integration
 * Connected to Supabase for patient data and Raspberry Pi sensor input
 * Now with live medicine stock data from Storage system
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
    summaryCard: document.getElementById('summaryCard'),
    // Pi elements
    piConnectionStatus: document.getElementById('piConnectionStatus'),
    piStats: document.getElementById('piStats')
};

// Medicine Data - now loaded from Supabase
let medicines = [];
let medicinesChannel = null;
let medicineLoadRetries = 0;
const MAX_MEDICINE_RETRIES = 3;

// Pi tracking variables
let lastProcessedReadingId = 0;

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
    console.log('Initializing dashboard with Pi and Storage integration...');
    
    // Start clock immediately
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    // Show loading state
    showDashboardLoading(true);
    
    // Load patient data from database
    const patientsLoaded = await loadPatientsFromDB();
    
    // Load medicine data from database with retry logic
    const medicinesLoaded = await loadMedicinesFromDB();
    if (medicinesLoaded) {
        initMedicinesRealtime();
    }
    
    if (patientsLoaded) {
        console.log(`Loaded ${patientsData.length} patients and ${medicines.length} medicines`);
        showDashboardLoading(false);
        renderAll();
    } else {
        console.error('Failed to load patients');
        showDashboardLoading(false);
        showErrorState('Failed to load data. Please refresh.');
    }
    
    // Initialize Pi monitoring
    initPiMonitoring();

    // Check for new hardware data every 30 seconds
    setInterval(async () => {
        const hasNewData = await syncHardwareData();
        if (hasNewData) {
            renderAll();
            showToast('New hardware data received');
        }
    }, 30000);
    
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
    renderMedicines();
    generateSummary();
}

function setupEventListeners() {
    if (elements.dismissBtn) elements.dismissBtn.addEventListener('click', dismissAllAlerts);
    if (elements.refreshPatientsBtn) elements.refreshPatientsBtn.addEventListener('click', () => refreshData('patients'));
    if (elements.refreshMedicineBtn) elements.refreshMedicineBtn.addEventListener('click', () => refreshData('medicine'));
    
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
        await refreshData('patients');
    });
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (medicinesChannel) {
            medicinesChannel.unsubscribe();
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
// MEDICINE DATA FROM STORAGE (SUPABASE) - FIXED
// ============================================

async function loadMedicinesFromDB() {
    console.log('Loading medicines from storage database...');
    
    // Check storage client is available
    if (!storageSupabaseClient) {
        console.error('Storage Supabase client not initialized');
        showToast('Storage database not connected', 'critical');
        return false;
    }
    
    for (let attempt = 0; attempt <= MAX_MEDICINE_RETRIES; attempt++) {
        if (attempt > 0) {
            console.log(`Retrying... Attempt ${attempt}/${MAX_MEDICINE_RETRIES}`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
        
        try {
            // Use storageSupabaseClient instead of supabaseClient
            const { data, error } = await storageSupabaseClient
                .from('medicines')
                .select('*')
                .order('slot_id', { ascending: true });

            if (!error) {
                // Success - reset retry counter
                medicineLoadRetries = 0;
                
                if (!data || data.length === 0) {
                    console.log('No medicines found in database');
                    medicines = [];
                    return true;
                }

                // Map database fields to frontend format
                medicines = data.map(med => ({
                    id: med.id,
                    slotId: med.slot_id,
                    name: med.med_name,
                    qty: med.quantity || 0,
                    pillWeight: med.pill_gram,
                    expiryDate: med.expiration_date,
                    status: getStockStatus(med.quantity)
                }));

                console.log(`Loaded ${medicines.length} medicines from storage database`);
                return true;
            }
            
            console.error('Failed to load medicines:', error);
            
        } catch (err) {
            console.error('Exception loading medicines:', err);
        }
    }
    
    // All retries exhausted
    showToast('Failed to load medicine data', 'critical');
    medicines = [];
    return false;
}

function getStockStatus(qty) {
    if (qty === null || qty === undefined || qty === 0) return 'out';
    if (qty <= 5) return 'low';
    if (qty <= 15) return 'medium';
    return 'good';
}

function initMedicinesRealtime() {
    if (medicinesChannel) {
        medicinesChannel.unsubscribe();
    }
    
    // Use storageSupabaseClient instead of supabaseClient
    medicinesChannel = storageSupabaseClient
        .channel('dashboard-medicines')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'medicines'
        }, (payload) => {
            console.log('Medicine data changed:', payload);
            handleMedicineChange(payload);
        })
        .subscribe((status) => {
            console.log('Medicines realtime status:', status);
            if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to medicine changes');
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.error('Medicine subscription issue:', status);
                setTimeout(() => initMedicinesRealtime(), 5000);
            }
        });
}

function handleMedicineChange(payload) {
    try {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        
        switch(eventType) {
            case 'INSERT':
                medicines.push({
                    id: newRecord.id,
                    slotId: newRecord.slot_id,
                    name: newRecord.med_name,
                    qty: newRecord.quantity || 0,
                    pillWeight: newRecord.pill_gram,
                    expiryDate: newRecord.expiration_date,
                    status: getStockStatus(newRecord.quantity)
                });
                break;
                
            case 'UPDATE':
                const index = medicines.findIndex(m => m.id === oldRecord.id);
                if (index !== -1) {
                    medicines[index] = {
                        id: newRecord.id,
                        slotId: newRecord.slot_id,
                        name: newRecord.med_name,
                        qty: newRecord.quantity || 0,
                        pillWeight: newRecord.pill_gram,
                        expiryDate: newRecord.expiration_date,
                        status: getStockStatus(newRecord.quantity)
                    };
                }
                break;
                
            case 'DELETE':
                medicines = medicines.filter(m => m.id !== oldRecord.id);
                break;
        }
        
        renderMedicines();
        generateSummary();
        
        const medName = newRecord?.med_name || oldRecord?.med_name;
        if (eventType === 'UPDATE' && medName) {
            showToast(`${medName} stock updated: ${newRecord.quantity} units`, 'success');
        }
    } catch (err) {
        console.error('Error handling medicine change:', err);
    }
}

function getExpiryStatus(expDateStr, today = new Date()) {
    if (!expDateStr) return { status: 'unknown', text: 'No date', badge: '-' };
    
    try {
        today.setHours(0, 0, 0, 0);
        const expDate = new Date(expDateStr);
        
        if (isNaN(expDate.getTime())) {
            return { status: 'unknown', text: 'Invalid date', badge: '-' };
        }
        
        expDate.setHours(0, 0, 0, 0);
        
        const diffTime = expDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            return { 
                status: 'expired', 
                text: `Expired ${Math.abs(diffDays)} days ago`, 
                badge: `<span class="expiry-badge expired"><i class="fa-solid fa-calendar-xmark"></i> EXPIRED</span>` 
            };
        }
        if (diffDays <= 7) {
            return { 
                status: 'near', 
                text: `${diffDays} days left`, 
                badge: `<span class="expiry-badge near"><i class="fa-solid fa-clock"></i> ${diffDays}d left</span>` 
            };
        }
        return { 
            status: 'good', 
            text: `${diffDays} days left`, 
            badge: `<span class="expiry-badge good"><i class="fa-solid fa-calendar-check"></i> OK</span>` 
        };
    } catch (err) {
        console.error('Error calculating expiry status:', err);
        return { status: 'unknown', text: 'Error', badge: '-' };
    }
}

// ============================================
// PI MONITORING FUNCTIONS
// ============================================

function initPiMonitoring() {
    checkPiStatus();
    processSensorReadings();
    
    setInterval(checkPiStatus, 5000);
    setInterval(processSensorReadings, 10000);
    
    console.log('Pi monitoring initialized');
}

async function checkPiStatus() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
    
    try {
        const { data, error } = await supabaseClient
            .from('sensor_readings')
            .select('*')
            .gte('created_at', fiveMinutesAgo)
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (error) {
            console.error('Pi status check error:', error);
            updatePiStatusUI('error', 'Connection error');
            return;
        }
        
        if (!data || data.length === 0) {
            updatePiStatusUI('offline', 'No recent readings');
            return;
        }
        
        const lastReading = data[0];
        const timeSince = Math.floor((Date.now() - new Date(lastReading.created_at)) / 1000);
        
        let timeText;
        if (timeSince < 60) {
            timeText = `${timeSince}s ago`;
        } else if (timeSince < 3600) {
            timeText = `${Math.floor(timeSince / 60)}m ago`;
        } else {
            timeText = `${Math.floor(timeSince / 3600)}h ago`;
        }
        
        updatePiStatusUI('online', timeText, lastReading);
        
    } catch (err) {
        console.error('Pi status exception:', err);
        updatePiStatusUI('error', 'Check failed');
    }
}

function updatePiStatusUI(status, timeText, reading = null) {
    if (!elements.piConnectionStatus || !elements.piStats) return;
    
    if (status === 'online') {
        elements.piConnectionStatus.innerHTML = `
            <span class="status-dot online"></span>
            <span style="color: rgba(144, 238, 144, 1);">Online (${timeText})</span>
        `;
        
        if (reading) {
            const tempColor = getTempColor(reading.temp_status);
            elements.piStats.innerHTML = `
                <strong>Last Patient:</strong> #${reading.patient_no}<br>
                <strong>Temp:</strong> ${reading.temperature}°C <span style="color:${tempColor}">(${reading.temp_status})</span><br>
                ${reading.has_pulse_data ? 
                    `<strong>HR:</strong> ${reading.heart_rate} bpm | <strong>SpO2:</strong> ${reading.spo2}%` : 
                    '<em style="opacity:0.6;">No pulse data</em>'}
            `;
        }
    } else if (status === 'offline') {
        elements.piConnectionStatus.innerHTML = `
            <span class="status-dot offline"></span>
            <span style="color: rgba(255,255,255,0.6);">Offline</span>
        `;
        elements.piStats.innerHTML = `
            ${timeText}<br>
            <small style="opacity:0.5;">Last check: ${new Date().toLocaleTimeString()}</small>
        `;
    } else {
        elements.piConnectionStatus.innerHTML = `
            <span class="status-dot offline"></span>
            <span style="color: #ff6b6b;">Error</span>
        `;
        elements.piStats.textContent = timeText;
    }
}

function getTempColor(status) {
    switch(status) {
        case 'HIGH': return '#ff6b6b';
        case 'FEVER': return '#FFD700';
        case 'LOW': return '#87CEEB';
        default: return '#32cd32';
    }
}

async function processSensorReadings() {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
    
    try {
        const { data: readings, error } = await supabaseClient
            .from('sensor_readings')
            .select('*')
            .eq('processed', false)
            .gte('created_at', tenMinutesAgo)
            .order('created_at', { ascending: true });
        
        if (error) {
            console.error('Sensor processing error:', error);
            return;
        }
        
        if (!readings || readings.length === 0) return;
        
        console.log(`Processing ${readings.length} sensor reading(s)...`);
        let processedCount = 0;
        
        for (const reading of readings) {
            if (reading.id <= lastProcessedReadingId) continue;
            
            const success = await processSingleReading(reading);
            if (success) {
                processedCount++;
                lastProcessedReadingId = Math.max(lastProcessedReadingId, reading.id);
            }
        }
        
        if (processedCount > 0) {
            await loadPatientsFromDB();
            renderAll();
            showToast(`${processedCount} new patient(s) from Pi monitor`);
        }
        
    } catch (err) {
        console.error('Process sensor readings exception:', err);
    }
}

async function processSingleReading(reading) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const hashtag = `#${String(reading.patient_no).padStart(3, '0')}`;
        
        const { data: existing, error: checkError } = await supabaseClient
            .from('patients')
            .select('*')
            .eq('hashtag', hashtag)
            .eq('date', today)
            .single();
        
        if (checkError && checkError.code !== 'PGRST116') {
            console.error('Check existing patient error:', checkError);
            return false;
        }
        
        const vitals = {
            temperature: reading.temperature ? `${reading.temperature}°C` : '-',
            heartRate: reading.heart_rate ? `${reading.heart_rate} bpm` : '-',
            bloodPressure: existing?.vitals?.bloodPressure || '-',
            oxygenSat: reading.spo2 ? `${reading.spo2}%` : '-'
        };
        
        let stability;
        if (typeof determineStability === 'function') {
            stability = determineStability(vitals);
        } else {
            stability = calculateStabilityFallback(vitals);
        }
        
        if (existing) {
            const { error: updateError } = await supabaseClient
                .from('patients')
                .update({
                    vitals: vitals,
                    status: stability.status,
                    stability_reason: stability.reason,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);
            
            if (updateError) {
                console.error('Update patient error:', updateError);
                return false;
            }
        } else {
            const time = new Date(reading.created_at).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', hour12: true
            });
            
            const { error: insertError } = await supabaseClient
                .from('patients')
                .insert([{
                    hashtag: hashtag,
                    date: today,
                    time: time,
                    name: '',
                    school_id: '',
                    age: null,
                    gender: '',
                    grade: '',
                    contact: '',
                    vitals: vitals,
                    status: stability.status,
                    stability_reason: stability.reason,
                    complaint: '',
                    notes: `Auto-generated from Raspberry Pi sensor | Temp Status: ${reading.temp_status} | Patient #: ${reading.patient_no}`
                }]);
            
            if (insertError) {
                console.error('Insert patient error:', insertError);
                return false;
            }
        }
        
        const { error: markError } = await supabaseClient
            .from('sensor_readings')
            .update({ processed: true })
            .eq('id', reading.id);
        
        if (markError) {
            console.error('Mark processed error:', markError);
        }
        
        return true;
        
    } catch (err) {
        console.error('Process single reading exception:', err);
        return false;
    }
}

function calculateStabilityFallback(vitals) {
    const temp = parseFloat(vitals.temperature);
    
    if (temp > 39 || temp < 35) {
        return { status: 'unstable', reason: `Critical temperature: ${temp}°C` };
    }
    if (temp > 37.4) {
        return { status: 'unstable', reason: `Fever detected: ${temp}°C` };
    }
    return { status: 'stable', reason: 'Temperature within normal range' };
}

// ============================================
// Clock
// ============================================
function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (elements.dateTime) {
        elements.dateTime.textContent = `${dateStr} | ${timeStr}`;
    }
}

// ============================================
// Patient Data Rendering
// ============================================
function renderPatients() {
    const todayPatients = typeof getTodayPatients === 'function' ? getTodayPatients() : [];
    const regStats = typeof getPatientRegistrationStats === 'function' ? getPatientRegistrationStats() : { 
        total: 0, registered: 0, pending: 0, percentComplete: 0 
    };
    
    const stableCount = todayPatients.filter(p => p.status === 'stable').length;
    const unstableCount = todayPatients.filter(p => p.status === 'unstable').length;
    
    elements.totalPatients.textContent = todayPatients.length;
    elements.stablePatients.textContent = stableCount;
    elements.unstablePatients.textContent = unstableCount;
    
    updateQueueProgress(regStats);
    
    elements.patientTable.innerHTML = '';
    
    if (todayPatients.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="4" style="text-align: center; padding: 24px; color: rgba(255,255,255,0.6);">
                <i class="fa-solid fa-inbox" style="display: block; margin-bottom: 12px; font-size: 1.5rem;"></i>
                No patients today
            </td>
        `;
        elements.patientTable.appendChild(row);
    } else {
        todayPatients.forEach((patient, index) => {
            const row = document.createElement('tr');
            const isStable = patient.status === 'stable';
            const isRegistered = typeof hasPatientBeenRegistered === 'function' 
                ? hasPatientBeenRegistered(patient) 
                : true;
            
            const isPiGenerated = patient.notes && patient.notes.includes('Raspberry Pi');
            
            row.style.cursor = 'pointer';
            row.onclick = () => viewPatientInHistory(patient.id);
            
            const registrationCell = isRegistered ? 
                '<span class="reg-icon registered" title="Registered"><i class="fa-solid fa-check"></i></span>' : 
                '<span class="reg-icon unregistered" title="Not Registered"><i class="fa-solid fa-xmark"></i></span>';
            
            const piBadge = isPiGenerated ? 
                '<span class="pi-badge" title="Auto-generated by Pi"><i class="fa-solid fa-microchip"></i></span>' : '';
            
            row.innerHTML = `
                <td><strong>${patient.hashtag}</strong>${piBadge}</td>
                <td>${patient.time}</td>
                <td style="text-align: center;">${registrationCell}</td>
                <td>
                    <span class="${isStable ? 'badge-stable' : 'badge-unstable'}">
                        <i class="fa-solid fa-${isStable ? 'check' : 'exclamation'}-circle"></i>
                        ${isStable ? 'Stable' : 'Unstable'}
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
            elements.queueStatusDetail.style.color = 'rgba(255,255,255,0.5)';
        } else if (pending === 0) {
            elements.queueStatusDetail.textContent = 'All patients registered! ✓';
            elements.queueStatusDetail.style.color = 'rgba(144, 238, 144, 1)';
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
// Medicine Stock Rendering (FIXED - Live from Storage)
// ============================================
function renderMedicines() {
    const tableBody = document.getElementById('medicineTable');
    if (!tableBody) {
        console.error('Medicine table body not found');
        return { lowCount: 0, mediumCount: 0, expiredCount: 0, nearExpiryCount: 0 };
    }

    let lowCount = 0, mediumCount = 0, expiredCount = 0, nearExpiryCount = 0;
    
    tableBody.innerHTML = '';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Sort medicines: critical first (expired → low stock → near expiry), then by slot
    const sortedMedicines = [...medicines].sort((a, b) => {
        const aExpiry = getExpiryStatus(a.expiryDate, today);
        const bExpiry = getExpiryStatus(b.expiryDate, today);
        
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
        
        // Then by stock level
        if (a.qty === 0 && b.qty !== 0) return -1;
        if (b.qty === 0 && a.qty !== 0) return 1;
        if (a.qty <= 5 && b.qty > 5) return -1;
        if (b.qty <= 5 && a.qty > 5) return -1;
        
        // Finally by slot ID
        return a.slotId - b.slotId;
    });

    if (sortedMedicines.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="4" style="text-align: center; padding: 24px; color: rgba(255,255,255,0.6);">
                <i class="fa-solid fa-inbox" style="display: block; margin-bottom: 12px; font-size: 1.5rem;"></i>
                No medicines in inventory
            </td>
        `;
        tableBody.appendChild(row);
        updateStockBadge(0, 0, 0, 0);
        return { lowCount: 0, mediumCount: 0, expiredCount: 0, nearExpiryCount: 0 };
    }

    sortedMedicines.forEach((med, index) => {
        const row = document.createElement('tr');
        
        const expiryInfo = getExpiryStatus(med.expiryDate, today);
        
        if (expiryInfo.status === 'expired') {
            row.classList.add('expired-row');
            expiredCount++;
        } else if (expiryInfo.status === 'near') {
            row.classList.add('near-expiry-row');
            nearExpiryCount++;
        }
        
        // Stock status HTML with quantity numbers
        let statusHtml = '', statusClass = '';
        if (med.qty === 0 || med.qty === null || med.qty === undefined) {
            statusHtml = `<i class="fa-solid fa-circle-xmark"></i> Out (0)`; 
            statusClass = 'stock-low';
            lowCount++;
        } else if (med.qty <= 5) { 
            statusHtml = `<i class="fa-solid fa-circle-exclamation"></i> Low (${med.qty})`; 
            statusClass = 'stock-low'; 
            lowCount++; 
        } else if (med.qty <= 15) { 
            statusHtml = `<i class="fa-solid fa-circle-half-stroke"></i> Med (${med.qty})`; 
            statusClass = 'stock-medium'; 
            mediumCount++; 
        } else { 
            statusHtml = `<i class="fa-solid fa-circle-check"></i> Good (${med.qty})`; 
            statusClass = 'stock-sufficient'; 
        }

        row.innerHTML = `
            <td><strong>${med.name}</strong><br><small style="opacity:0.6;">Slot #${med.slotId}</small></td>
            <td class="weight-display" style="color: ${med.qty === 0 ? '#ff9f9f' : (med.qty <= 5 ? '#ffd700' : 'rgba(144, 238, 144, 1)')}">${med.qty !== null ? med.qty : 0}</td>
            <td class="${statusClass}">${statusHtml}</td>
            <td>${expiryInfo.badge}</td>
        `;
        
        row.title = `Slot #${med.slotId} | Pill: ${med.pillWeight}g | ${expiryInfo.text}`;
        
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
        badge.textContent = 'Stock Good';
        badge.style.background = 'rgba(0, 128, 0, 0.6)';
        badge.style.color = 'rgba(144, 238, 144, 1)';
    }
}

function showInventoryAlerts(expired, nearExpiry, lowStock) {
    // Only show each alert type once per session
    if (expired > 0 && !inventoryAlertsShown.expired) {
        addAlert('critical', 'fa-solid fa-calendar-xmark', 
            `${expired} medicine(s) have EXPIRED! Check storage immediately.`);
        inventoryAlertsShown.expired = true;
    }
    if (nearExpiry > 0 && !inventoryAlertsShown.nearExpiry) {
        addAlert('warning', 'fa-solid fa-clock', 
            `${nearExpiry} medicine(s) expiring within 7 days.`);
        inventoryAlertsShown.nearExpiry = true;
    }
    if (lowStock > 0 && !inventoryAlertsShown.lowStock) {
        addAlert('warning', 'fa-solid fa-box-open', 
            `${lowStock} medicine(s) running low on stock (5 or fewer).`);
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
    const todayPatients = typeof getTodayPatients === 'function' ? getTodayPatients() : [];
    const regStats = typeof getPatientRegistrationStats === 'function' ? getPatientRegistrationStats() : { 
        registered: 0, pending: 0 
    };
    const medicineStats = renderMedicines();
    
    const stableCount = todayPatients.filter(p => p.status === 'stable').length;
    const unstableCount = todayPatients.filter(p => p.status === 'unstable').length;
    const alertCount = unstableCount + medicineStats.lowCount + medicineStats.expiredCount;

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
            <div class="summary-number" style="color: ${regStats.pending > 0 ? '#FFD700' : 'rgba(144, 238, 144, 1)'};">${regStats.pending}</div>
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
            <div class="summary-number" style="color: ${medicineStats.lowCount > 0 || medicineStats.expiredCount > 0 ? '#ff6b6b' : 'rgba(144, 238, 144, 1)'};">${medicineStats.lowCount + medicineStats.expiredCount}</div>
            <div class="summary-label">Stock Issues</div>
        </div>
    `;

    renderAlerts(unstableCount, medicineStats, todayPatients);
}

function renderAlerts(unstableCount, medicineStats, patients) {
    elements.alerts.innerHTML = '';
    
    if (unstableCount === 0 && medicineStats.lowCount === 0 && medicineStats.expiredCount === 0) {
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
            
            const isPiGenerated = patient.notes && patient.notes.includes('Raspberry Pi');
            const sourceBadge = isPiGenerated ? '<span class="pi-badge" style="margin-left:5px;"><i class="fa-solid fa-microchip"></i></span>' : '';
            
            alert.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div>
                    <strong>${patient.hashtag} - ${patient.name || 'Unknown'}${sourceBadge}</strong>
                    <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Unstable patient requires attention</div>
                    ${vitalDetails}
                </div>
            `;
            
            alert.style.cursor = 'pointer';
            alert.onclick = () => viewPatientInHistory(patient.id);
            elements.alerts.appendChild(alert);
        });
    }
    
    if (medicineStats.expiredCount > 0) {
        const alert = document.createElement('li');
        alert.className = 'alert-item critical';
        alert.innerHTML = `
            <i class="fa-solid fa-calendar-xmark"></i>
            <div>
                <strong>${medicineStats.expiredCount} Medicine(s) EXPIRED</strong>
                <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Immediate action required - Check storage</div>
            </div>
        `;
        elements.alerts.appendChild(alert);
    }
    
    if (medicineStats.nearExpiryCount > 0) {
        const alert = document.createElement('li');
        alert.className = 'alert-item warning';
        alert.innerHTML = `
            <i class="fa-solid fa-clock"></i>
            <div>
                <strong>${medicineStats.nearExpiryCount} Medicine(s) Expiring Soon</strong>
                <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">Within 7 days - Plan restocking</div>
            </div>
        `;
        elements.alerts.appendChild(alert);
    }
    
    if (medicineStats.lowCount > 0) {
        const alert = document.createElement('li');
        alert.className = 'alert-item warning';
        alert.innerHTML = `
            <i class="fa-solid fa-box-open"></i>
            <div>
                <strong>${medicineStats.lowCount} Medicine(s) Low Stock</strong>
                <div style="font-size:0.85rem;opacity:0.9;margin-top:2px;">5 or fewer units remaining</div>
            </div>
        `;
        elements.alerts.appendChild(alert);
    }
    
    updateAlertsScroll();
}

// ============================================
// Navigation
// ============================================
function viewPatientInHistory(patientId) {
    window.location.href = `history.html?patientId=${patientId}`;
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
        medicineLoadRetries = 0; // Reset retries
        const loaded = await loadMedicinesFromDB();
        if (loaded) {
            renderMedicines();
            generateSummary();
            showToast('Medicine stock refreshed');
        } else {
            showToast('Failed to refresh medicine data', 'critical');
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
// Initialize on DOM Ready
// ============================================
document.addEventListener('DOMContentLoaded', initDashboard);