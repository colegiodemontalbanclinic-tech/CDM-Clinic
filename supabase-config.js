// ============================================
// SUPABASE CONFIGURATION - CDM Clinic
// Session-based authentication (NO localStorage)
// ============================================

const SUPABASE_URL = 'https://hgtdktoonaqiwmnenikb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhndGRrdG9vbmFxaXdtbmVuaWtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTM4ODgsImV4cCI6MjA5MDA4OTg4OH0.6NXKSNNy2sgf0tXwmYqv_PPK27KoWB3lCw93YPZx1do';

// Initialize Supabase client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// SESSION MANAGEMENT (Memory + Database only)
// ============================================

// Store session in memory (lost on page refresh, verified against DB)
let currentSession = null;

// Generate random session token
function generateSessionToken() {
    return Math.random().toString(36).substring(2) + 
            Math.random().toString(36).substring(2) +
            Date.now().toString(36);
}

// Verify admin login and create session
async function verifyAdminLogin(username, password) {
    const { data, error } = await supabaseClient
        .from('admin_users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();
    
    if (error || !data) {
        return { success: false, message: 'Invalid username or password' };
    }
    
    // Create session token
    const token = generateSessionToken();
    const expiry = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
    
    // Save to database
    await supabaseClient
        .from('admin_users')
        .update({ 
            session_token: token,
            token_expiry: expiry.toISOString()
        })
        .eq('id', data.id);
    
    // Store in memory only
    currentSession = {
        token: token,
        username: data.username,
        expiry: expiry
    };
    
    return { success: true, user: data };
}

// Check if user is logged in (for protected pages)
async function checkSession() {
    if (!currentSession) return false;
    
    // Check memory expiry
    if (new Date() > currentSession.expiry) {
        currentSession = null;
        return false;
    }
    
    // Verify against database
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
}

// Logout - clear session from database and memory
async function logoutAdmin() {
    if (currentSession) {
        await supabaseClient
            .from('admin_users')
            .update({ session_token: null, token_expiry: null })
            .eq('session_token', currentSession.token);
    }
    currentSession = null;
    window.location.href = 'login.html';
}

// Update admin password
async function updateAdminPassword(username, newPassword) {
    const { error } = await supabaseClient
        .from('admin_users')
        .update({ password: newPassword })
        .eq('username', username);
    
    return !error;
}

// ============================================
// PATIENT DATABASE FUNCTIONS
// ============================================

async function fetchPatientsFromDB() {
    const { data, error } = await supabaseClient
        .from('patients')
        .select('*')
        .order('id', { ascending: true });
    
    if (error) {
        console.error('Error fetching patients:', error);
        return null;
    }
    return data;
}

async function fetchPatientById(id) {
    const { data, error } = await supabaseClient
        .from('patients')
        .select('*')
        .eq('id', id)
        .single();
    
    if (error) return null;
    return data;
}

async function updatePatientInDB(patient) {
    const { error } = await supabaseClient
        .from('patients')
        .update({
            name: patient.name,
            school_id: patient.schoolId,
            age: patient.age,
            gender: patient.gender,
            grade: patient.grade,
            contact: patient.contact,
            vitals: patient.vitals,
            status: patient.status,
            stability_reason: patient.stabilityReason,
            complaint: patient.complaint,
            notes: patient.notes,
            updated_at: new Date().toISOString()
        })
        .eq('id', patient.id);
    
    return !error;
}

async function addPatientToDB(patient) {
    const { data, error } = await supabaseClient
        .from('patients')
        .insert([{
            hashtag: patient.hashtag,
            date: patient.date,
            time: patient.time,
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
            notes: patient.notes || ''
        }]);
    
    if (error) return null;
    return data;
}

// ============================================
// SYNC FUNCTION - Load patients from DB to memory
// ============================================

async function syncPatientsWithDB() {
    const dbPatients = await fetchPatientsFromDB();
    if (dbPatients) {
        window.patientsData = dbPatients.map(p => ({
            id: p.id,
            hashtag: p.hashtag,
            date: p.date,
            time: p.time,
            name: p.name,
            schoolId: p.school_id,
            age: p.age,
            gender: p.gender,
            grade: p.grade,
            contact: p.contact,
            vitals: p.vitals || {},
            status: p.status,
            stabilityReason: p.stability_reason,
            complaint: p.complaint,
            notes: p.notes
        }));
        
        if (typeof initializeAllStatuses === 'function') {
            initializeAllStatuses();
        }
        return true;
    }   
    return false;
}

// ============================================
// GLOBAL EXPORTS
// ============================================

window.supabaseClient = supabaseClient;
window.verifyAdminLogin = verifyAdminLogin;
window.checkSession = checkSession;
window.logoutAdmin = logoutAdmin;
window.updateAdminPassword = updateAdminPassword;
window.fetchPatientsFromDB = fetchPatientsFromDB;
window.fetchPatientById = fetchPatientById;
window.updatePatientInDB = updatePatientInDB;
window.addPatientToDB = addPatientToDB;
window.syncPatientsWithDB = syncPatientsWithDB;