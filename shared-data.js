// ============================================
// SHARED DATA - Database Version
// Fetches from Supabase, maintains same API
// ============================================

// PATIENTS DATABASE (original)
const SUPABASE_URL = 'https://hgtdktoonaqiwmnenikb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhndGRrdG9vbmFxaXdtbmVuaWtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTM4ODgsImV4cCI6MjA5MDA4OTg4OH0.6NXKSNNy2sgf0tXwmYqv_PPK27KoWB3lCw93YPZx1do';

// STORAGE DATABASE (medicines)
const STORAGE_SUPABASE_URL = 'https://cbenviudczmhrthvqntc.supabase.co';
const STORAGE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiZW52aXVkY3ptaHJ0aHZxbnRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjAyMDcsImV4cCI6MjA5MTAzNjIwN30.oxBJwGZmta9B-qZi4_zmr_71-ktx-fafS_JidP9IWu0';

// Initialize Supabase clients with error handling
let supabaseClient;
let storageSupabaseClient;

try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase client (patients) initialized successfully');
} catch (err) {
    console.error('Failed to initialize Supabase client (patients):', err);
    supabaseClient = null;
}

try {
    storageSupabaseClient = supabase.createClient(STORAGE_SUPABASE_URL, STORAGE_SUPABASE_ANON_KEY);
    console.log('Supabase client (storage) initialized successfully');
} catch (err) {
    console.error('Failed to initialize Supabase client (storage):', err);
    storageSupabaseClient = null;
}

// Global patients data (loaded from DB)
let patientsData = [];

// ============================================
// VITAL SIGNS RANGES & THRESHOLDS
// Standard Normal Ranges:
// - Temperature: 36.5°C - 37.3°C (Average: 37.0°C / 98.6°F)
// - Heart Rate: 60 - 100 bpm
// - Blood Pressure: 90/60 - 120/80 mmHg
// - Oxygen Saturation: 96% - 100%
// ============================================
const VITAL_RANGES = {
    temperature: { min: 36.5, max: 37.3, unit: '°C', average: 37.0 },
    heartRate: { min: 60, max: 100, unit: 'bpm' },
    bloodPressureSystolic: { min: 90, max: 120, unit: 'mmHg' },
    bloodPressureDiastolic: { min: 60, max: 80, unit: 'mmHg' },
    oxygenSat: { min: 96, max: 100, unit: '%' }
};

const CRITICAL_THRESHOLDS = {
    temperature: { min: 36.5, max: 37.3 },
    heartRate: { min: 60, max: 100 },
    bloodPressureSystolic: { min: 90, max: 120 },
    bloodPressureDiastolic: { min: 60, max: 80 },
    oxygenSat: { min: 96, max: 100 }
};

// ============================================
// PHILIPPINE TIME (UTC+8) HELPER FUNCTIONS - REALTIME
// ============================================

/**
 * Get current date in Philippine Time (UTC+8) as YYYY-MM-DD string
 * CRITICAL: This must match the format stored in your database
 */
function getTodayDate() {
    const now = new Date();

    // Use Intl.DateTimeFormat with explicit Philippine timezone
    const phFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const parts = phFormatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;

    const today = `${year}-${month}-${day}`;

    console.log('getTodayDate() - Philippine Time:', today);

    return today;
}

/**
 * Get full Philippine timestamp for realtime display
 * Returns object with formatted date, time, and ISO string
 */
function getPhilippineTimestamp() {
    const now = new Date();

    // Date formatter for PH time
    const phDateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Time formatter for PH time (HH:MM:SS AM/PM)
    const phTimeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    // ISO timestamp in PH time
    const phTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Manila' });
    const phDate = new Date(phTimeString);

    return {
        date: phDateFormatter.format(now),
        time: phTimeFormatter.format(now),
        iso: phDate.toISOString(),
        dateString: phDate.toISOString().substring(0, 10) // YYYY-MM-DD
    };
}

/**
 * Get current time in Philippine Time (HH:MM AM/PM format)
 * For display purposes
 */
function getPhilippineTime() {
    const now = new Date();

    const phFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    return phFormatter.format(now);
}

/**
 * Extract YYYY-MM-DD from any date format
 * Handles: strings, Date objects, ISO timestamps, PostgreSQL timestamps
 */
function extractDateString(dateInput) {
    if (!dateInput) return null;

    // If it's already a string
    if (typeof dateInput === 'string') {
        // Already in YYYY-MM-DD format
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
            return dateInput;
        }
        // ISO format with time: "2026-04-17T00:00:00" or "2026-04-17T00:00:00.000Z"
        if (dateInput.includes('T')) {
            return dateInput.substring(0, 10);
        }
        // PostgreSQL format: "2026-04-17 00:00:00+00"
        if (dateInput.includes(' ')) {
            return dateInput.substring(0, 10);
        }
        // Try parsing as date string
        const parsed = new Date(dateInput);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().substring(0, 10);
        }
        return dateInput;
    }

    // If it's a Date object
    if (dateInput instanceof Date) {
        if (isNaN(dateInput.getTime())) return null;
        return dateInput.toISOString().substring(0, 10);
    }

    // If it's a number (timestamp)
    if (typeof dateInput === 'number') {
        const date = new Date(dateInput);
        return date.toISOString().substring(0, 10);
    }

    // Last resort: convert to string and try to extract
    const str = String(dateInput);
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return match[0];
    }

    return null;
}

/**
 * Normalize date to YYYY-MM-DD (UTC format, not Philippine Time)
 * Database stores UTC dates, we compare as UTC to avoid timezone confusion
 */
function normalizeDate(dateInput) {
    if (!dateInput) return null;

    const extracted = extractDateString(dateInput);
    if (extracted) return extracted;

    // Fallback: try Philippine time conversion
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
        console.warn('Invalid date input:', dateInput);
        return null;
    }

    // Convert to PH time then format
    const phFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const parts = phFormatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;

    return `${year}-${month}-${day}`;
}

/**
 * Convert a date string to Philippine Time date string (YYYY-MM-DD)
 */
function toPhilippineDateString(dateStr) {
    return normalizeDate(dateStr);
}

/**
 * Get all unique dates from patientsData for debugging
 */
function getAvailableDates() {
    const dates = patientsData.map(p => p.date).filter(d => d);
    return [...new Set(dates)].sort();
}

// ============================================
// HASHTAG FUNCTIONS - DAILY 0-999 RANGE
// ============================================

/**
 * Format number to daily hashtag (0-999, 3-digit padding)
 * Examples: 1 → #001, 10 → #010, 100 → #100, 999 → #999
 * 
 * @param {number|string} id - Patient number or hashtag string
 * @returns {string} Formatted hashtag like "#001"
 */
function formatHashtag(id) {
    // Handle null/undefined
    if (id === null || id === undefined) return '#000';

    // If already a hashtag string, extract the number
    let num;
    if (typeof id === 'string') {
        // Remove # and any non-numeric characters
        const cleanStr = id.replace('#', '').replace(/\D/g, '');
        num = parseInt(cleanStr);
    } else {
        num = parseInt(id);
    }

    // Validate number
    if (isNaN(num) || num < 0) return '#000';

    // Cap at 999 for daily range
    if (num > 999) num = num % 1000; // Wrap around if exceeds 999

    // Ensure 0-999 range with 3-digit zero padding
    return '#' + String(num).padStart(3, '0');
}

/**
 * Extract hashtag number from hashtag string
 * @param {string} hashtag - Hashtag string like "#001"
 * @returns {number} Numeric value (1-999)
 */
function extractHashtagNumber(hashtag) {
    if (!hashtag || typeof hashtag !== 'string') return 0;
    const match = hashtag.match(/#(\d{3})/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Sort patients by hashtag number (001-999)
 * For consistent ordering across dashboard and history
 */
function sortPatientsByHashtag(patients) {
    return patients.sort((a, b) => {
        const numA = extractHashtagNumber(a.hashtag);
        const numB = extractHashtagNumber(b.hashtag);
        return numA - numB;
    });
}

// ============================================
// DATABASE FUNCTIONS - FIXED FOR DATE HANDLING
// ============================================

// Load patients from Supabase
async function loadPatientsFromDB() {
    if (!supabaseClient) {
        console.error('Supabase client not initialized');
        return false;
    }

    try {
        console.log('Fetching patients data...');

        const { data, error } = await supabaseClient
            .from('patients')
            .select('*')
            .order('id', { ascending: true });

        if (error) {
            console.error('Error loading patients:', error);
            return false;
        }

        if (!data) {
            console.warn('No data returned');
            patientsData = [];
            window.patientsData = patientsData;
            return true;
        }

        console.log(`Retrieved ${data.length} records from database`);

        // Transform DB format to app format
        patientsData = data.map(p => {
            // CRITICAL FIX: Extract clean YYYY-MM-DD from any date format
            let cleanDate = null;

            if (p.date) {
                cleanDate = extractDateString(p.date);
                if (!cleanDate) {
                    cleanDate = normalizeDate(p.date);
                }
            }

            return {
                id: p.id,
                hashtag: p.hashtag,
                date: cleanDate || p.date,  // Use cleaned date
                time: p.time,
                name: p.name || '',
                schoolId: p.school_id || '',
                age: p.age || '',
                gender: p.gender || '',
                grade: p.grade || '',
                contact: p.contact || '',
                vitals: p.vitals || {},
                status: p.status || 'stable',
                stabilityReason: p.stability_reason || '',
                complaint: p.complaint || '',
                notes: p.notes || ''
            };
        });

        // Initialize statuses for all patients
        initializeAllStatuses();

        // Update global reference
        window.patientsData = patientsData;

        // Debug output
        if (patientsData.length > 0) {
            const uniqueDates = getAvailableDates();
            console.log('Patient date range:', {
                oldest: uniqueDates[0],
                newest: uniqueDates[uniqueDates.length - 1],
                uniqueDates: uniqueDates.length,
                last10Dates: uniqueDates.slice(-10)
            });

            const today = getTodayDate();
            const todayPatients = getTodayPatients();
            console.log(`Today's patients (${today}):`, todayPatients.length);
        }

        console.log(`Successfully loaded ${patientsData.length} patients`);
        return true;

    } catch (err) {
        console.error('Exception loading patients:', err);
        console.error('Stack trace:', err.stack);
        return false;
    }
}

// Save patient to database
async function savePatientToDB(patient) {
    if (!supabaseClient) {
        console.error('Supabase client not initialized');
        return false;
    }

    if (!patient || !patient.id) {
        console.error('Invalid patient object:', patient);
        return false;
    }

    try {
        console.log(`Saving patient ${patient.id}...`);

        const updateData = {
            name: patient.name || '',
            school_id: patient.schoolId || '',
            age: patient.age || null,
            gender: patient.gender || '',
            grade: patient.grade || '',
            contact: patient.contact || '',
            vitals: patient.vitals || {},
            status: patient.status || 'stable',
            stability_reason: patient.stabilityReason || '',
            complaint: patient.complaint || '',
            notes: patient.notes || '',
            updated_at: new Date().toISOString()
        };

        const { error } = await supabaseClient
            .from('patients')
            .update(updateData)
            .eq('id', patient.id);

        if (error) {
            console.error('Error saving patient:', error);
            return false;
        }

        console.log(`Patient ${patient.id} saved successfully`);
        return true;

    } catch (err) {
        console.error('Exception saving patient:', err);
        return false;
    }
}

// ============================================
// LARGE INVENTORY FUNCTIONS (for Dashboard Medicine Stock)
// ============================================

/**
 * Load large inventory items from storage database
 * Used by dashboard to display inventory stock levels
 */
async function loadLargeInventoryFromDB() {
    if (!storageSupabaseClient) {
        console.error('Storage Supabase client not initialized');
        return false;
    }

    try {
        console.log('Fetching large inventory data...');

        const { data, error } = await storageSupabaseClient
            .from('large_inventory')
            .select('*')
            .order('id', { ascending: true });

        if (error) {
            console.error('Error loading large inventory:', error);
            return false;
        }

        if (!data) {
            console.warn('No large inventory data returned');
            return [];
        }

        console.log(`Retrieved ${data.length} records from large_inventory`);
        return data;

    } catch (err) {
        console.error('Exception loading large inventory:', err);
        return false;
    }
}

/**
 * Get inventory statistics for dashboard display
 * Calculates expired, near expiry, low stock, and medium stock counts
 */
function getLargeInventoryStats(inventory) {
    if (!Array.isArray(inventory)) {
        console.warn('Invalid inventory data provided to getLargeInventoryStats');
        return { expiredCount: 0, nearExpiryCount: 0, lowStockCount: 0, mediumCount: 0, total: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysFromNow = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000));

    let expiredCount = 0;
    let nearExpiryCount = 0;
    let lowStockCount = 0;
    let mediumCount = 0;

    inventory.forEach(item => {
        // Check stock levels
        if (item.quantity === null || item.quantity === undefined || item.quantity === 0) {
            lowStockCount++;
        } else if (item.quantity <= 5) {
            lowStockCount++;
        } else if (item.quantity <= 15) {
            mediumCount++;
        }

        // Check expiry
        if (item.expiration_date) {
            const expDate = new Date(item.expiration_date);
            expDate.setHours(0, 0, 0, 0);

            if (expDate < today) {
                expiredCount++;
            } else if (expDate <= sevenDaysFromNow) {
                nearExpiryCount++;
            }
        }
    });

    return { 
        expiredCount, 
        nearExpiryCount, 
        lowStockCount, 
        mediumCount, 
        total: inventory.length 
    };
}

/**
 * Get stock status classification for inventory items
 * Returns: 'out', 'low', 'medium', 'good'
 */
function getInventoryStockStatus(quantity) {
    if (quantity === null || quantity === undefined || quantity === 0) return 'out';
    if (quantity <= 5) return 'low';
    if (quantity <= 15) return 'medium';
    return 'good';
}

/**
 * Get expiry status for inventory items
 * Returns object with status, text, and badge HTML
 */
function getInventoryExpiryStatus(expDateStr, today = new Date()) {
    if (!expDateStr) return { status: 'unknown', text: 'No date', badge: '-', daysLeft: null };

    try {
        today.setHours(0, 0, 0, 0);
        const expDate = new Date(expDateStr);

        if (isNaN(expDate.getTime())) {
            return { status: 'unknown', text: 'Invalid date', badge: '-', daysLeft: null };
        }

        expDate.setHours(0, 0, 0, 0);

        const diffTime = expDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            return { 
                status: 'expired', 
                text: `Expired ${Math.abs(diffDays)} days ago`, 
                badge: `<span class="expiry-badge expired"><i class="fa-solid fa-calendar-xmark"></i> EXPIRED</span>`,
                daysLeft: diffDays
            };
        }
        if (diffDays <= 7) {
            return { 
                status: 'near', 
                text: `${diffDays} days left`, 
                badge: `<span class="expiry-badge near"><i class="fa-solid fa-clock"></i> ${diffDays}d left</span>`,
                daysLeft: diffDays
            };
        }
        return { 
            status: 'good', 
            text: `${diffDays} days left`, 
            badge: `<span class="expiry-badge good"><i class="fa-solid fa-calendar-check"></i> ${diffDays}d left</span>`,
            daysLeft: diffDays
        };
    } catch (err) {
        console.error('Error calculating expiry status:', err);
        return { status: 'unknown', text: 'Error', badge: '-', daysLeft: null };
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function parseVitalValue(value) {
    if (!value || value === '-') return null;
    const numericMatch = value.toString().match(/[\d.]+/);
    return numericMatch ? parseFloat(numericMatch[0]) : null;
}

function parseBloodPressure(bpString) {
    if (!bpString || bpString === '-') return { systolic: null, diastolic: null };
    const parts = bpString.toString().split('/');
    return {
        systolic: parseFloat(parts[0]) || null,
        diastolic: parts[1] ? parseFloat(parts[1]) : null
    };
}

function determineStability(vitals) {
    const temp = parseVitalValue(vitals.temperature);
    const hr = parseVitalValue(vitals.heartRate);
    const bp = parseBloodPressure(vitals.bloodPressure);
    const o2 = parseVitalValue(vitals.oxygenSat);

    let stabilityScore = 0;
    let criticalIssues = [];

    if (temp !== null) {
        if (temp < CRITICAL_THRESHOLDS.temperature.min || temp > CRITICAL_THRESHOLDS.temperature.max) {
            return { status: 'unstable', reason: `Critical temperature: ${temp}°C (Normal: ${VITAL_RANGES.temperature.min}-${VITAL_RANGES.temperature.max}°C, Avg: ${VITAL_RANGES.temperature.average}°C)` };
        }
        if (temp < VITAL_RANGES.temperature.min || temp > VITAL_RANGES.temperature.max) {
            stabilityScore += 1;
            criticalIssues.push(`Temperature: ${temp}°C (Normal: ${VITAL_RANGES.temperature.min}-${VITAL_RANGES.temperature.max}°C)`);
        }
    }

    if (hr !== null) {
        if (hr < CRITICAL_THRESHOLDS.heartRate.min || hr > CRITICAL_THRESHOLDS.heartRate.max) {
            return { status: 'unstable', reason: `Critical heart rate: ${hr} bpm (Normal: ${VITAL_RANGES.heartRate.min}-${VITAL_RANGES.heartRate.max} bpm)` };
        }
        if (hr < VITAL_RANGES.heartRate.min || hr > VITAL_RANGES.heartRate.max) {
            stabilityScore += 1;
            criticalIssues.push(`Heart Rate: ${hr} bpm (Normal: ${VITAL_RANGES.heartRate.min}-${VITAL_RANGES.heartRate.max} bpm)`);
        }
    }

    if (bp.systolic !== null && bp.diastolic !== null) {
        if (bp.systolic > CRITICAL_THRESHOLDS.bloodPressureSystolic.max || 
            bp.systolic < CRITICAL_THRESHOLDS.bloodPressureSystolic.min ||
            bp.diastolic > CRITICAL_THRESHOLDS.bloodPressureDiastolic.max || 
            bp.diastolic < CRITICAL_THRESHOLDS.bloodPressureDiastolic.min) {
            return { status: 'unstable', reason: `Critical blood pressure: ${bp.systolic}/${bp.diastolic} mmHg (Normal: ${VITAL_RANGES.bloodPressureSystolic.min}/${VITAL_RANGES.bloodPressureDiastolic.min}-${VITAL_RANGES.bloodPressureSystolic.max}/${VITAL_RANGES.bloodPressureDiastolic.max} mmHg)` };
        }
        if (bp.systolic > VITAL_RANGES.bloodPressureSystolic.max || 
            bp.systolic < VITAL_RANGES.bloodPressureSystolic.min ||
            bp.diastolic > VITAL_RANGES.bloodPressureDiastolic.max || 
            bp.diastolic < VITAL_RANGES.bloodPressureDiastolic.min) {
            stabilityScore += 1;
            criticalIssues.push(`BP: ${bp.systolic}/${bp.diastolic} mmHg`);
        }
    }

    if (o2 !== null) {
        if (o2 < CRITICAL_THRESHOLDS.oxygenSat.min) {
            return { status: 'unstable', reason: `Critical oxygen saturation: ${o2}% (Normal: ${VITAL_RANGES.oxygenSat.min}-${VITAL_RANGES.oxygenSat.max}%)` };
        }
        if (o2 < VITAL_RANGES.oxygenSat.min) {
            stabilityScore += 2;
            criticalIssues.push(`O₂ Sat: ${o2}% (Normal: ≥${VITAL_RANGES.oxygenSat.min}%)`);
        }
    }

    if (stabilityScore >= 2) {
        return { status: 'unstable', reason: `Multiple abnormal vitals: ${criticalIssues.join(', ')}` };
    }
    if (stabilityScore === 1) {
        return { status: 'stable', reason: `Monitored: ${criticalIssues[0]}` };
    }
    return { status: 'stable', reason: 'All vitals within normal range' };
}

function updatePatientStatus(patient) {
    if (!patient || !patient.vitals) return patient;
    const stabilityCheck = determineStability(patient.vitals);
    patient.status = stabilityCheck.status;
    patient.stabilityReason = stabilityCheck.reason;
    return patient;
}

function getVitalClass(type, value) {
    const numValue = parseVitalValue(value);
    if (numValue === null) return '';

    switch(type) {
        case 'temp':
            if (numValue < 36.1 || numValue > 37.2) return 'vital-abnormal';
            break;
        case 'hr':
            if (numValue < 60 || numValue > 100) return 'vital-abnormal';
            break;
        case 'o2':
            if (numValue < 95) return 'vital-critical';
            break;
        case 'bp':
            const bp = parseBloodPressure(value);
            if (bp.systolic && (bp.systolic > VITAL_RANGES.bloodPressureSystolic.max || bp.systolic < VITAL_RANGES.bloodPressureSystolic.min)) return 'vital-abnormal';
            if (bp.diastolic && (bp.diastolic > VITAL_RANGES.bloodPressureDiastolic.max || bp.diastolic < VITAL_RANGES.bloodPressureDiastolic.min)) return 'vital-abnormal';
            break;
    }
    return 'vital-normal';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

/**
 * Get today's patients - SORTED BY HASHTAG NUMBER (001-999)
 * This function now handles ALL possible date format mismatches
 */
function getTodayPatients() {
    // Get today's date in YYYY-MM-DD format
    const today = getTodayDate();

    console.group('=== getTodayPatients() DEBUG ===');
    console.log('Looking for date:', today);
    console.log('Total patients in memory:', patientsData.length);

    if (patientsData.length === 0) {
        console.warn('No patients loaded in memory!');
        console.groupEnd();
        return [];
    }

    // Show sample of patient dates for comparison
    const sampleDates = patientsData.slice(0, 5).map(p => ({
        id: p.id,
        hashtag: p.hashtag,
        date: p.date,
        dateType: typeof p.date,
        dateLength: String(p.date).length
    }));
    console.log('Sample patient dates from DB:', sampleDates);

    // Show all available dates
    const allDates = getAvailableDates();
    console.log('All available dates:', allDates.slice(-10));

    // CRITICAL FIX: Filter using extracted date strings
    let todayPatients = patientsData.filter(p => {
        // Extract clean date string from patient data
        const patientDate = extractDateString(p.date);
        const searchDate = today;

        const isMatch = patientDate === searchDate;

        // Log first few comparisons
        if (patientsData.indexOf(p) < 3) {
            console.log(`  Comparing: "${patientDate}" === "${searchDate}" ? ${isMatch}`);
        }

        return isMatch;
    });

    // SORT BY HASHTAG NUMBER for consistent 001-999 ordering
    todayPatients = sortPatientsByHashtag(todayPatients);

    console.log(`Found ${todayPatients.length} patients for today (${today})`);

    // FALLBACK: If no patients found, check yesterday and tomorrow (timezone issues)
    if (todayPatients.length === 0 && allDates.length > 0) {
        console.log('No patients found for today. Checking for timezone offset...');

        // Calculate yesterday and tomorrow
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const yesterdayStr = yesterday.toISOString().substring(0, 10);
        const tomorrowStr = tomorrow.toISOString().substring(0, 10);

        const yesterdayPatients = patientsData.filter(p => {
            const pDate = extractDateString(p.date);
            return pDate === yesterdayStr;
        });
        const tomorrowPatients = patientsData.filter(p => {
            const pDate = extractDateString(p.date);
            return pDate === tomorrowStr;
        });

        if (yesterdayPatients.length > 0) {
            console.warn(`Found ${yesterdayPatients.length} patients for YESTERDAY (${yesterdayStr})`);
        }
        if (tomorrowPatients.length > 0) {
            console.warn(`Found ${tomorrowPatients.length} patients for TOMORROW (${tomorrowStr})`);
        }

        // If there's a mismatch, log the most recent date
        const mostRecentDate = allDates[allDates.length - 1];
        if (mostRecentDate !== today) {
            console.warn(`Most recent data is from ${mostRecentDate}, not today (${today})`);
        }
    }

    console.groupEnd();
    return todayPatients;
}

function hasPatientBeenRegistered(patient) {
    if (!patient || !patient.name) return false;
    const trimmedName = patient.name.trim();
    return trimmedName.length > 0 && trimmedName !== '-';
}

function getPatientRegistrationStats() {
    const todayPatients = getTodayPatients();
    const total = todayPatients.length;
    const registered = todayPatients.filter(p => hasPatientBeenRegistered(p)).length;
    const pending = total - registered;
    const percentComplete = total > 0 ? Math.round((registered / total) * 100) : 0;

    return { total, registered, pending, percentComplete };
}

function initializeAllStatuses() {
    if (!Array.isArray(patientsData)) {
        console.warn('patientsData is not an array');
        return;
    }
    patientsData.forEach(patient => updatePatientStatus(patient));
}

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

let currentSession = null;

function generateSessionToken() {
    return Math.random().toString(36).substring(2) + 
            Math.random().toString(36).substring(2) +
            Date.now().toString(36);
}

async function verifyAdminLogin(username, password) {
    if (!supabaseClient) return { success: false, message: 'Database not connected' };

    try {
        const { data, error } = await supabaseClient
            .from('admin_users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        if (error || !data) {
            return { success: false, message: 'Invalid username or password' };
        }

        const token = generateSessionToken();
        const expiry = new Date(Date.now() + 8 * 60 * 60 * 1000);

        await supabaseClient
            .from('admin_users')
            .update({ 
                session_token: token,
                token_expiry: expiry.toISOString()
            })
            .eq('id', data.id);

        currentSession = {
            token: token,
            username: data.username,
            expiry: expiry
        };

        return { success: true, user: data };
    } catch (err) {
        console.error('Login error:', err);
        return { success: false, message: 'Login failed' };
    }
}

async function checkSession() {
    if (!currentSession) return false;
    if (new Date() > currentSession.expiry) {
        currentSession = null;
        return false;
    }

    try {
        const { data, error } = await supabaseClient
            .from('admin_users')
            .select('*')
            .eq('session_token', currentSession.token)
            .gt('token_expiry', new Date().toISOString())
            .single();

        if (error || !data) {
            currentSession = null;
            return false;
        }
        return true;
    } catch (err) {
        return false;
    }
}

async function logoutAdmin() {
    if (currentSession && supabaseClient) {
        await supabaseClient
            .from('admin_users')
            .update({ session_token: null, token_expiry: null })
            .eq('session_token', currentSession.token);
    }
    currentSession = null;
    window.location.href = 'login.html';
}

async function updateAdminPassword(username, newPassword) {
    if (!supabaseClient) return false;

    try {
        const { error } = await supabaseClient
            .from('admin_users')
            .update({ password: newPassword })
            .eq('username', username);
        return !error;
    } catch (err) {
        return false;
    }
}

// ============================================
// HARDWARE SYNC FUNCTIONS
// ============================================

async function syncHardwareData() {
    if (!supabaseClient) return false;

    try {
        const { data, error } = await supabaseClient
            .from('raw_vitals')
            .select('*')
            .eq('processed', false)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Error fetching hardware data:', error);
            return false;
        }

        if (data && data.length > 0) {
            console.log(`Found ${data.length} new hardware readings`);
            await loadPatientsFromDB();
            return true;
        }
        return false;
    } catch (err) {
        console.error('Hardware sync error:', err);
        return false;
    }
}

// ============================================
// DEBUG FUNCTIONS
// ============================================

/**
 * Debug function to check today's patients data
 * Call this in browser console: debugTodayPatients()
 */
function debugTodayPatients() {
    console.group('=== DEBUG: Today Patients ===');
    console.log('Today (PH):', getTodayDate());
    console.log('Browser timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Total patients in memory:', patientsData.length);

    const todayPatients = getTodayPatients();
    console.log('Today patients count:', todayPatients.length);

    if (todayPatients.length > 0) {
        console.log('Today patients list (sorted by hashtag):');
        todayPatients.forEach(p => {
            console.log(`  - ${p.hashtag}: ${p.name || '(unregistered)'} at ${p.time}, status: ${p.status}`);
        });
    } else {
        const allDates = getAvailableDates();
        console.log('Available dates in DB:', allDates);
        console.log('Most recent date:', allDates[allDates.length - 1]);

        // Check if dates are just slightly off
        const today = getTodayDate();
        console.log('Looking for exact match on:', today);
        patientsData.forEach(p => {
            const pDate = extractDateString(p.date);
            console.log(`  Patient ${p.hashtag}: stored="${p.date}" extracted="${pDate}" match=${pDate===today}`);
        });
    }

    console.groupEnd();
    return todayPatients;
}

/**
 * Force reload patients and refresh display
 */
async function forceRefreshPatients() {
    console.log('Force refreshing patients...');
    const loaded = await loadPatientsFromDB();

    if (loaded) {
        initializeAllStatuses();
        const today = getTodayDate();
        const todayPatients = getTodayPatients();
        console.log(`Refresh complete. Today (${today}): ${todayPatients.length} patients`);

        if (typeof renderAll === 'function') {
            renderAll();
        }

        return todayPatients;
    }

    console.error('Failed to refresh patients');
    return [];
}

// ============================================
// GLOBAL EXPORTS
// ============================================
window.patientsData = patientsData;
window.supabaseClient = supabaseClient;
window.storageSupabaseClient = storageSupabaseClient;
window.loadPatientsFromDB = loadPatientsFromDB;
window.savePatientToDB = savePatientToDB;
window.parseVitalValue = parseVitalValue;
window.parseBloodPressure = parseBloodPressure;
window.determineStability = determineStability;
window.updatePatientStatus = updatePatientStatus;
window.getVitalClass = getVitalClass;
window.formatHashtag = formatHashtag;
window.formatDate = formatDate;
window.getTodayDate = getTodayDate;
window.getTodayPatients = getTodayPatients; 
window.hasPatientBeenRegistered = hasPatientBeenRegistered;
window.getPatientRegistrationStats = getPatientRegistrationStats;
window.initializeAllStatuses = initializeAllStatuses;

// NEW EXPORTS for hashtag system and PH time
window.getPhilippineTimestamp = getPhilippineTimestamp;
window.getPhilippineTime = getPhilippineTime;
window.extractHashtagNumber = extractHashtagNumber;
window.sortPatientsByHashtag = sortPatientsByHashtag;

// Auth exports
window.verifyAdminLogin = verifyAdminLogin;
window.checkSession = checkSession;
window.logoutAdmin = logoutAdmin;
window.updateAdminPassword = updateAdminPassword;
window.currentSession = currentSession;
window.syncHardwareData = syncHardwareData;

// Debug exports
window.debugTodayPatients = debugTodayPatients;
window.forceRefreshPatients = forceRefreshPatients;
window.toPhilippineDateString = toPhilippineDateString;
window.getAvailableDates = getAvailableDates;
window.normalizeDate = normalizeDate;
window.extractDateString = extractDateString;

// NEW: Large inventory exports for dashboard integration
window.loadLargeInventoryFromDB = loadLargeInventoryFromDB;
window.getLargeInventoryStats = getLargeInventoryStats;
window.getInventoryStockStatus = getInventoryStockStatus;
window.getInventoryExpiryStatus = getInventoryExpiryStatus;