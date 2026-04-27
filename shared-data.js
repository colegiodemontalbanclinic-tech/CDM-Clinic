// ============================================
// SHARED DATA - Raw Vitals Direct Storage Version
// All patient registration data stored in raw_vitals table
// UPDATED: Fixed Philippine timezone date extraction for raw_vitals
// UPDATED: Added extractPhilippineDate() helper for consistent date handling
// UPDATED: Added getLargeInventoryStats() for storage page
// UPDATED: Fixed inventory status badge HTML generation
// UPDATED: Added getInventoryBadgeHTML() helper
// ============================================

// SUPABASE CONFIG
const SUPABASE_URL = 'https://hgtdktoonaqiwmnenikb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhndGRrdG9vbmFxaXdtbmVuaWtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTM4ODgsImV4cCI6MjA5MDA4OTg4OH0.6NXKSNNy2sgf0tXwmYqv_PPK27KoWB3lCw93YPZx1do';

// STORAGE DATABASE (medicines - keep for inventory)
const STORAGE_SUPABASE_URL = 'https://cbenviudczmhrthvqntc.supabase.co';
const STORAGE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiZW52aXVkY3ptaHJ0aHZxbnRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjAyMDcsImV4cCI6MjA5MTAzNjIwN30.oxBJwGZmta9B-qZi4_zmr_71-ktx-fafS_JidP9IWu0';

let supabaseClient;
let storageSupabaseClient;

try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase client initialized');
} catch (err) {
    console.error('Failed to initialize Supabase:', err);
    supabaseClient = null;
}

try {
    storageSupabaseClient = supabase.createClient(STORAGE_SUPABASE_URL, STORAGE_SUPABASE_ANON_KEY);
    console.log('Storage client initialized');
} catch (err) {
    console.error('Failed to initialize storage:', err);
    storageSupabaseClient = null;
}

// In-memory cache of raw_vitals (transformed to patient format)
let patientsData = [];
let rawVitalsChannel = null;
const SYNC_INTERVAL_MS = 5000; // 5 seconds

// ============================================
// PHILIPPINE TIME
// ============================================

function getTodayDate() {
    const now = new Date();
    const phFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = phFormatter.formatToParts(now);
    return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
}

function getPhilippineTimestamp() {
    const now = new Date();
    return {
        date: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now),
        time: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)
    };
}

function getPhilippineTime() {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date());
}

// ============================================
// NEW: EXTRACT PHILIPPINE DATE FROM ISO TIMESTAMP
// Fixes timezone mismatch between UTC storage and PH display
// ============================================

/**
 * Extract Philippine calendar date from any ISO timestamp string.
 * Converts UTC timestamps to Asia/Manila timezone before extracting date.
 * This ensures patient.date matches the Philippine calendar date when vitals were measured.
 * 
 * @param {string} dateStr - ISO timestamp (e.g., "2026-04-25T01:00:00+08:00" or "2026-04-24T17:00:00Z")
 * @returns {string} Date in YYYY-MM-DD format (Philippine Time)
 */
function extractPhilippineDate(dateStr) {
    if (!dateStr) return getTodayDate();
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

// ============================================
// HASHTAG FUNCTIONS
// ============================================

function formatHashtag(id) {
    if (id === null || id === undefined) return '#000';
    let num = typeof id === 'string' ? parseInt(id.replace('#', '').replace(/\D/g, '')) : parseInt(id);
    if (isNaN(num) || num < 0) return '#000';
    if (num > 999) num = num % 1000;
    return '#' + String(num).padStart(3, '0');
}

function extractHashtagNumber(hashtag) {
    if (!hashtag || typeof hashtag !== 'string') return 0;
    const match = hashtag.match(/#(\d{3})/);
    return match ? parseInt(match[1]) : 0;
}

function sortPatientsByHashtag(patients) {
    return patients.sort((a, b) => extractHashtagNumber(a.hashtag) - extractHashtagNumber(b.hashtag));
}

// ============================================
// RAW VITALS → PATIENTS TRANSFORM
// ============================================

/**
 * Convert raw_vitals row to patient format for display
 * Reads ALL saved registration fields from the database
 * FIXED: Uses extractPhilippineDate() for correct timezone handling
 */
function rawVitalToPatient(raw) {
    // FIXED: Extract date using Philippine timezone (not UTC substring)
    const date = extractPhilippineDate(raw.measured_at || raw.created_at);

    // FIXED: Extract time using Philippine timezone
    const timeStr = raw.measured_at || raw.created_at;
    const time = timeStr 
        ? new Date(timeStr).toLocaleTimeString('en-US', { 
            timeZone: 'Asia/Manila',
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
          }) 
        : getPhilippineTime();

    // Build vitals from raw data (including saved blood_pressure)
    const vitals = {
        temperature: raw.temperature !== null ? `${raw.temperature}°C` : '',
        heartRate: raw.heart_rate !== null ? `${raw.heart_rate}` : '',
        oxygenSat: raw.spo2 !== null ? `${raw.spo2}%` : '',
        bloodPressure: raw.blood_pressure || ''
    };

    // Use saved status/reason from DB if available, otherwise calculate from vitals
    let status = raw.status || 'stable';
    let stabilityReason = raw.stability_reason || 'All vitals within normal range';

    // Only auto-calculate if no saved status exists (new/unregistered record)
    if (!raw.status) {
        if (raw.temp_status === 'HIGH' || raw.temp_status === 'FEVER') {
            status = 'unstable';
            stabilityReason = `Temperature ${raw.temperature}°C - ${raw.temp_status}`;
        } else if (raw.heart_rate !== null && (raw.heart_rate < 60 || raw.heart_rate > 100)) {
            status = 'unstable';
            stabilityReason = `Heart rate ${raw.heart_rate} bpm abnormal`;
        } else if (raw.spo2 !== null && raw.spo2 < 95) {
            status = 'unstable';
            stabilityReason = `Oxygen saturation ${raw.spo2}% low`;
        }
    }

    return {
        id: raw.id,
        hashtag: formatHashtag(raw.patient_number),
        date: date,
        time: time,
        // Registration fields — read from DB if saved, otherwise empty
        name: raw.name || '',
        schoolId: raw.school_id || '',
        age: raw.age || '',
        gender: raw.gender || '',
        grade: raw.grade || '',
        contact: raw.contact || '',
        guardian: raw.guardian || '',
        address: raw.address || '',
        birthdate: raw.birthdate || '',
        complaint: raw.complaint || '',
        notes: raw.notes || '',
        management: raw.management || '',
        vitals: vitals,
        status: status,
        stabilityReason: stabilityReason,
        // Keep raw reference
        rawVitalId: raw.id,
        printed: raw.printed || false
    };
}

// ============================================
// SAVE PATIENT TO DATABASE (raw_vitals directly)
// ============================================

/**
 * Save all patient registration data directly to raw_vitals table
 * This is the single source of truth — no separate patients table needed
 * 
 * DEBUG: If this returns false, check browser console for detailed error logs.
 * Common causes:
 *   1. RLS (Row Level Security) enabled on raw_vitals with no UPDATE policy for anon role
 *   2. patient.id is undefined/null (data transformation issue)
 *   3. Supabase client not initialized
 */
async function savePatientToDB(patient) {
    if (!supabaseClient) {
        console.error('[savePatientToDB] Supabase not initialized');
        return false;
    }

    // CRITICAL: Verify we have a valid ID
    if (!patient.id) {
        console.error('[savePatientToDB] patient.id is missing!', patient);
        return false;
    }

    console.log('[savePatientToDB] Saving patient ID:', patient.id, 'Type:', typeof patient.id);

    try {
        // Build update object with ALL registration fields
        const updateData = {
            // Registration fields
            name: patient.name || null,
            school_id: patient.schoolId || null,
            age: patient.age || null,
            gender: patient.gender || null,
            grade: patient.grade || null,
            contact: patient.contact || null,
            guardian: patient.guardian || null,
            address: patient.address || null,
            birthdate: patient.birthdate || null,
            blood_pressure: patient.vitals?.bloodPressure || null,
            complaint: patient.complaint || null,
            notes: patient.notes || null,
            management: patient.management || null,

            // Status fields (calculated from vitals)
            status: patient.status || 'stable',
            stability_reason: patient.stabilityReason || null,

            // Mark as processed/registered and update timestamp
            processed: true,
            printed: true,
            updated_at: new Date().toISOString()
        };

        console.log('[savePatientToDB] Update payload:', updateData);

        // Update the raw_vitals table directly — single source of truth
        // Use .select() to verify rows were actually updated
        const { data, error, count } = await supabaseClient
            .from('raw_vitals')
            .update(updateData)
            .eq('id', patient.id)
            .select();  // ← Returns updated rows to verify success

        if (error) {
            console.error('[savePatientToDB] Supabase error:', error);
            console.error('[savePatientToDB] Error details:', JSON.stringify(error));
            return false;
        }

        // CRITICAL: Check if any rows were actually updated
        // If RLS blocks the update, data will be empty array with no error
        if (!data || data.length === 0) {
            console.error('[savePatientToDB] UPDATE AFFECTED 0 ROWS!');
            console.error('[savePatientToDB] This usually means RLS is blocking the update.');
            console.error('[savePatientToDB] Go to Supabase Dashboard → Database → RLS Policies → raw_vitals');
            console.error('[savePatientToDB] Add policy: ENABLE UPDATE for anon role (or authenticated role)');
            return false;
        }

        console.log('[savePatientToDB] SUCCESS! Updated rows:', data.length);
        console.log('[savePatientToDB] Updated row:', data[0]);

        // Update in-memory data so UI reflects changes immediately
        // Properly merge nested objects (vitals) to prevent data loss
        const index = patientsData.findIndex(p => p.id === patient.id);
        if (index !== -1) {
            patientsData[index] = { 
                ...patientsData[index], 
                ...patient,
                vitals: {
                    ...patientsData[index].vitals,
                    ...patient.vitals
                }
            };
        }

        return true;

    } catch (err) {
        console.error('[savePatientToDB] Exception:', err);
        return false;
    }
}

// ============================================
// LOAD DATA FROM RAW_VITALS DIRECTLY
// ============================================

/**
 * Load all records from raw_vitals and transform to patients format
 */
async function loadPatientsFromDB() {
    if (!supabaseClient) {
        console.error('Supabase not initialized');
        return false;
    }

    try {
        console.log('Loading from raw_vitals...');

        const { data, error } = await supabaseClient
            .from('raw_vitals')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error loading raw_vitals:', error);
            return false;
        }

        if (!data) {
            patientsData = [];
            window.patientsData = patientsData;
            return true;
        }

        console.log(`Loaded ${data.length} raw_vitals records`);

        // Transform all raw_vitals to patient format
        patientsData = data.map(rawVitalToPatient);
        window.patientsData = patientsData;

        console.log(`Transformed to ${patientsData.length} patient records`);
        console.log('Sample:', patientsData.slice(0, 2));

        return true;

    } catch (err) {
        console.error('Exception loading raw_vitals:', err);
        return false;
    }
}

/**
 * Get today's patients from raw_vitals (already in memory)
 * Uses Philippine date for consistent filtering
 */
function getTodayPatients() {
    const today = getTodayDate();
    console.log('getTodayPatients() looking for date:', today);
    console.log('Total in memory:', patientsData.length);

    const todayPatients = patientsData.filter(p => {
        const match = p.date === today;
        console.log(`  ${p.hashtag}: date="${p.date}" vs "${today}" → ${match}`);
        return match;
    });

    console.log(`Found ${todayPatients.length} patients for today`);
    return sortPatientsByHashtag([...todayPatients]);
}

/**
 * Get ALL patients (for history page)
 * No date filtering — returns complete dataset
 */
function getAllPatients() {
    return sortPatientsByHashtag([...patientsData]);
}

// ============================================
// REALTIME SYNC
// ============================================

async function initRawVitalsSync() {
    console.log('Initializing raw_vitals sync...');

    // Initial load
    await loadPatientsFromDB();

    // Setup realtime
    setupRawVitalsRealtime();

    // Backup polling
    setInterval(async () => {
        console.log('Polling raw_vitals...');
        await loadPatientsFromDB();
        if (typeof renderAll === 'function') renderAll();
        if (typeof renderTable === 'function') renderTable();
    }, SYNC_INTERVAL_MS);
}

function setupRawVitalsRealtime() {
    if (rawVitalsChannel) rawVitalsChannel.unsubscribe();

    rawVitalsChannel = supabaseClient
        .channel('raw-vitals-live')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'raw_vitals'
        }, async (payload) => {
            console.log('Realtime change:', payload.eventType, payload.new);

            // Reload all data (simplest approach)
            await loadPatientsFromDB();

            // Refresh displays
            if (typeof renderAll === 'function') renderAll();
            if (typeof renderTable === 'function') renderTable();
            if (typeof updateStats === 'function') updateStats();
        })
        .subscribe((status) => {
            console.log('Realtime status:', status);
            if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                setTimeout(setupRawVitalsRealtime, 5000);
            }
        });
}

function cleanupRawVitalsSync() {
    if (rawVitalsChannel) {
        rawVitalsChannel.unsubscribe();
        rawVitalsChannel = null;
    }
}

// ============================================
// REGISTRATION STATS (for queue progress)
// ============================================

function hasPatientBeenRegistered(patient) {
    return patient.name && patient.name.trim().length > 0;
}

function getPatientRegistrationStats() {
    const todayPatients = getTodayPatients();
    const total = todayPatients.length;
    const registered = todayPatients.filter(p => hasPatientBeenRegistered(p)).length;
    return {
        total,
        registered,
        pending: total - registered,
        percentComplete: total > 0 ? Math.round((registered / total) * 100) : 0
    };
}

// ============================================
// INVENTORY (large_inventory table)
// ============================================

async function loadLargeInventoryFromDB() {
    if (!storageSupabaseClient) return false;
    try {
        const { data, error } = await storageSupabaseClient
            .from('large_inventory')
            .select('*')
            .order('id', { ascending: true });
        if (error) { console.error(error); return false; }
        return data || [];
    } catch (err) { console.error(err); return false; }
}

function getInventoryStockStatus(qty) {
    if (qty === null || qty === undefined || qty === 0) return 'out';
    if (qty <= 5) return 'low';
    if (qty <= 15) return 'medium';
    return 'good';
}

function getInventoryExpiryStatus(expDateStr, today = new Date()) {
    if (!expDateStr) return { status: 'unknown', text: 'No date', badge: '-', daysLeft: null };
    try {
        today.setHours(0,0,0,0);
        const exp = new Date(expDateStr);
        exp.setHours(0,0,0,0);
        const days = Math.ceil((exp - today) / (1000*60*60*24));
        if (days < 0) return { status: 'expired', text: `Expired ${Math.abs(days)}d ago`, badge: `<span class="expiry-badge expired"><i class="fa-solid fa-calendar-xmark"></i> EXPIRED</span>`, daysLeft: days };
        if (days <= 7) return { status: 'near', text: `${days}d left`, badge: `<span class="expiry-badge near"><i class="fa-solid fa-clock"></i> ${days}d left</span>`, daysLeft: days };
        return { status: 'good', text: `${days}d left`, badge: `<span class="expiry-badge good"><i class="fa-solid fa-calendar-check"></i> ${days}d left</span>`, daysLeft: days };
    } catch (e) { return { status: 'unknown', text: 'Error', badge: '-', daysLeft: null }; }
}

// ============================================
// NEW: INVENTORY STATS (for storage page)
// ============================================

/**
 * Calculate comprehensive stats for large_inventory
 * Used by storage.js updateStats() and dashboard inventory alerts
 */
function getLargeInventoryStats(inventory) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let total = inventory ? inventory.length : 0;
    let expiredCount = 0;
    let nearExpiryCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let mediumStockCount = 0;
    let goodStockCount = 0;
    
    inventory.forEach(item => {
        const qty = item.quantity || 0;
        const expiryInfo = getInventoryExpiryStatus(item.expiration_date, today);
        
        // Expiry counts
        if (expiryInfo.status === 'expired') expiredCount++;
        else if (expiryInfo.status === 'near') nearExpiryCount++;
        
        // Stock counts
        if (qty === 0) outOfStockCount++;
        else if (qty <= 5) lowStockCount++;
        else if (qty <= 15) mediumStockCount++;
        else goodStockCount++;
    });
    
    return {
        total,
        expiredCount,
        nearExpiryCount,
        lowStockCount,
        outOfStockCount,
        mediumStockCount,
        goodStockCount,
        criticalCount: expiredCount + nearExpiryCount + outOfStockCount + lowStockCount,
        healthyCount: mediumStockCount + goodStockCount
    };
}

// ============================================
// NEW: INVENTORY BADGE HTML GENERATOR
// ============================================

/**
 * Generate HTML badge for inventory expiry status
 * Uses the same CSS classes as patient status badges
 */
function getInventoryBadgeHTML(expiryStatus, daysLeft) {
    switch(expiryStatus) {
        case 'expired':
            return `<span class="expiry-badge expired"><i class="fa-solid fa-calendar-xmark"></i> EXPIRED</span>`;
        case 'near':
            return `<span class="expiry-badge near"><i class="fa-solid fa-clock"></i> ${daysLeft}d left</span>`;
        case 'good':
            return `<span class="expiry-badge good"><i class="fa-solid fa-calendar-check"></i> ${daysLeft}d left</span>`;
        default:
            return `<span class="expiry-badge">-</span>`;
    }
}

/**
 * Generate HTML badge for inventory stock status
 * Uses the same CSS classes as quantity badges
 */
function getStockBadgeHTML(stockStatus, qty) {
    let badgeClass, icon;
    switch(stockStatus) {
        case 'out':
            badgeClass = 'qty-zero';
            icon = 'circle-xmark';
            break;
        case 'low':
            badgeClass = 'qty-low';
            icon = 'triangle-exclamation';
            break;
        case 'medium':
            badgeClass = 'qty-good';
            icon = 'check';
            break;
        case 'good':
        default:
            badgeClass = 'qty-good';
            icon = 'check';
            break;
    }
    return `<span class="quantity-badge ${badgeClass}"><i class="fa-solid fa-${icon}"></i> ${qty}</span>`;
}

// ============================================
// VITAL HELPERS
// ============================================

function parseVitalValue(value) {
    if (!value || value === '-') return null;
    const m = value.toString().match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
}

function getVitalClass(type, value) {
    const num = parseVitalValue(value);
    if (num === null) return '';
    switch(type) {
        case 'temp': return (num < 36.1 || num > 37.2) ? 'vital-abnormal' : 'vital-normal';
        case 'hr': return (num < 60 || num > 100) ? 'vital-abnormal' : 'vital-normal';
        case 'o2': return num < 95 ? 'vital-critical' : 'vital-normal';
        default: return 'vital-normal';
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return dateStr; }
}

// ============================================
// AUTH (keep existing)
// ============================================

let currentSession = null;

async function verifyAdminLogin(username, password) {
    if (!supabaseClient) return { success: false, message: 'No DB' };
    try {
        const { data, error } = await supabaseClient.from('admin_users').select('*').eq('username', username).eq('password', password).single();
        if (error || !data) return { success: false, message: 'Invalid login' };
        const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
        await supabaseClient.from('admin_users').update({ session_token: token, token_expiry: expiry.toISOString() }).eq('id', data.id);
        currentSession = { token, username: data.username, expiry };
        return { success: true, user: data };
    } catch (err) { return { success: false, message: 'Login failed' }; }
}

async function logoutAdmin() {
    if (currentSession && supabaseClient) {
        await supabaseClient.from('admin_users').update({ session_token: null, token_expiry: null }).eq('session_token', currentSession.token);
    }
    currentSession = null;
    window.location.href = 'login.html';
}

// ============================================
// EXPORTS
// ============================================

window.patientsData = patientsData;
window.supabaseClient = supabaseClient;
window.storageSupabaseClient = storageSupabaseClient;
window.loadPatientsFromDB = loadPatientsFromDB;
window.getTodayPatients = getTodayPatients;
window.getAllPatients = getAllPatients;
window.hasPatientBeenRegistered = hasPatientBeenRegistered;
window.getPatientRegistrationStats = getPatientRegistrationStats;
window.initRawVitalsSync = initRawVitalsSync;
window.setupRawVitalsRealtime = setupRawVitalsRealtime;
window.cleanupRawVitalsSync = cleanupRawVitalsRealtime;
window.rawVitalToPatient = rawVitalToPatient;
window.savePatientToDB = savePatientToDB;

window.getTodayDate = getTodayDate;
window.getPhilippineTimestamp = getPhilippineTimestamp;
window.getPhilippineTime = getPhilippineTime;
window.extractPhilippineDate = extractPhilippineDate;  // NEW: Export for use in history.js
window.formatHashtag = formatHashtag;
window.extractHashtagNumber = extractHashtagNumber;
window.sortPatientsByHashtag = sortPatientsByHashtag;
window.formatDate = formatDate;
window.parseVitalValue = parseVitalValue;
window.getVitalClass = getVitalClass;

window.loadLargeInventoryFromDB = loadLargeInventoryFromDB;
window.getInventoryStockStatus = getInventoryStockStatus;
window.getInventoryExpiryStatus = getInventoryExpiryStatus;
window.getLargeInventoryStats = getLargeInventoryStats;
window.getInventoryBadgeHTML = getInventoryBadgeHTML;
window.getStockBadgeHTML = getStockBadgeHTML;

window.verifyAdminLogin = verifyAdminLogin;
window.logoutAdmin = logoutAdmin;
window.currentSession = currentSession;