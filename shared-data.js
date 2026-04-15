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
// ============================================
const VITAL_RANGES = {
    temperature: { min: 36.1, max: 37.2, unit: '°C' },
    heartRate: { min: 60, max: 100, unit: 'bpm' },
    bloodPressureSystolic: { min: 90, max: 120, unit: 'mmHg' },
    bloodPressureDiastolic: { min: 60, max: 80, unit: 'mmHg' },
    oxygenSat: { min: 95, max: 100, unit: '%' }
};

const CRITICAL_THRESHOLDS = {
    temperature: { min: 35.0, max: 39.0 },
    heartRate: { min: 50, max: 120 },
    oxygenSat: { min: 92, max: 100 }
};

// ============================================
// DATABASE FUNCTIONS
// ============================================

// Load patients from Supabase with better error handling
async function loadPatientsFromDB() {
    // Check if Supabase client is available
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
            console.error('Error details:', error.message, error.code);
            return false;
        }
        
        // Handle empty data
        if (!data) {
            console.warn('No data returned');
            patientsData = [];
            window.patientsData = patientsData;
            return true; // Return true but empty
        }
        
        console.log(`Retrieved ${data.length} records`);
        
        // Transform DB format to app format
        patientsData = data.map(p => ({
            id: p.id,
            hashtag: p.hashtag,
            date: p.date,
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
        }));
        
        // Initialize statuses for all patients
        initializeAllStatuses();
        
        // Update global reference
        window.patientsData = patientsData;
        
        console.log(`Successfully loaded ${patientsData.length} patients`);
        return true;
        
    } catch (err) {
        console.error('Exception loading patients:', err);
        console.error('Stack trace:', err.stack);
        return false;
    }
}

// Save patient to database with better error handling
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
            console.error('Error details:', error.message, error.code);
            return false;
        }
        
        console.log(`Patient ${patient.id} saved successfully`);
        return true;
        
    } catch (err) {
        console.error('Exception saving patient:', err);
        console.error('Stack trace:', err.stack);
        return false;
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
            return { status: 'unstable', reason: `Critical temperature: ${temp}°C` };
        }
        if (temp < VITAL_RANGES.temperature.min || temp > VITAL_RANGES.temperature.max) {
            stabilityScore += 1;
            criticalIssues.push(`Temperature: ${temp}°C (Normal: ${VITAL_RANGES.temperature.min}-${VITAL_RANGES.temperature.max}°C)`);
        }
    }
    
    if (hr !== null) {
        if (hr < CRITICAL_THRESHOLDS.heartRate.min || hr > CRITICAL_THRESHOLDS.heartRate.max) {
            return { status: 'unstable', reason: `Critical heart rate: ${hr} bpm` };
        }
        if (hr < VITAL_RANGES.heartRate.min || hr > VITAL_RANGES.heartRate.max) {
            stabilityScore += 1;
            criticalIssues.push(`Heart Rate: ${hr} bpm (Normal: ${VITAL_RANGES.heartRate.min}-${VITAL_RANGES.heartRate.max} bpm)`);
        }
    }
    
    if (bp.systolic !== null && bp.diastolic !== null) {
        if (bp.systolic > 180 || bp.systolic < 90 || bp.diastolic > 120 || bp.diastolic < 60) {
            return { status: 'unstable', reason: `Critical blood pressure: ${bp.systolic}/${bp.diastolic} mmHg` };
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
            return { status: 'unstable', reason: `Critical oxygen saturation: ${o2}%` };
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
            if (bp.systolic && (bp.systolic > 120 || bp.systolic < 90)) return 'vital-abnormal';
            break;
    }
    return 'vital-normal';
}

function formatHashtag(id) {
    return `#${String(id).padStart(3, '0')}`;
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

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function getTodayPatients() {
    const today = getTodayDate();
    return patientsData.filter(p => p.date === today);
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
// AUTHENTICATION FUNCTIONS (from supabase-config.js)
// ============================================

// Session management
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
    "Fetch latest unprocessed vitals from hardware"
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
            // Trigger a refresh of patient data
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

// Auth exports
window.verifyAdminLogin = verifyAdminLogin;
window.checkSession = checkSession;
window.logoutAdmin = logoutAdmin;
window.updateAdminPassword = updateAdminPassword;
window.currentSession = currentSession;
window.syncHardwareData = syncHardwareData;