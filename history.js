// ============================================
// SCHOOL CLINIC PATIENT HISTORY SYSTEM
// Uses Supabase database for patient data storage
// ============================================

// State Management
let filteredData = [];
let currentPage = 1;
const itemsPerPage = 25;  // Changed to 25 rows per page for better fit
let currentPatient = null;
let isDataLoaded = false;

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    startClock();
    initializeDates();
    
    showLoading(true);
    
    const loaded = await loadPatientsFromDB();
    
    if (loaded && patientsData.length > 0) {
        filteredData = [...patientsData];
        isDataLoaded = true;
        
        checkForSelectedPatient();
        
        renderTable();
        updateStats();
        updateRegistrationProgress();
        showLoading(false);
    } else {
        showLoading(false);
        showEmptyState('No patient records found');
    }
    
    setupEventListeners();
    setupModalCloseHandlers(); // Added for robust modal closing
});

function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item[data-section]').forEach(function(item) {
        item.addEventListener('click', function() {
            const section = this.getAttribute('data-section');
            
            if (section === 'dashboard') {
                window.location.href = 'dashboard.html';
                return;
            }
            
            document.querySelectorAll('.nav-item').forEach(function(nav) { 
                nav.classList.remove('active'); 
            });
            this.classList.add('active');
        });
    });
    
    // Sign Out Modal
    document.getElementById('signOutBtn').addEventListener('click', showSignOutModal);
    document.getElementById('cancelSignOut').addEventListener('click', hideSignOutModal);
    
    // FIXED: Use proper ID for confirm sign out button
    const confirmBtn = document.getElementById('confirmSignOut') || document.getElementById('SignOut');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmSignOut);
    }
    
    // Search inputs
    document.getElementById('searchHashtag').addEventListener('input', debounce(applyFilters, 300));
    document.getElementById('searchName').addEventListener('input', debounce(applyFilters, 300));
    document.getElementById('dateFrom').addEventListener('change', applyFilters);
    document.getElementById('dateTo').addEventListener('change', applyFilters);
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideSignOutModal();
            closeModal();
        }
    });
}

// ============================================
// NEW: Robust Modal Close Handlers
// ============================================
function setupModalCloseHandlers() {
    // Sign Out Modal - close when clicking outside
    const signOutModal = document.getElementById('signOutModal');
    if (signOutModal) {
        signOutModal.addEventListener('click', function(e) {
            // If click is directly on the modal background (not the content)
            if (e.target === this) {
                hideSignOutModal();
            }
        });
    }
    
    // Patient Modal - close when clicking outside
    const patientModal = document.getElementById('patientModal');
    if (patientModal) {
        patientModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal();
            }
        });
    }
}

// ============================================
// Loading State Management
// ============================================
function showLoading(show) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const tableWrapper = document.getElementById('tableWrapper');
    const tablePagination = document.getElementById('tablePagination');
    
    if (loadingIndicator) loadingIndicator.style.display = show ? 'block' : 'none';
    if (tableWrapper) tableWrapper.style.display = show ? 'none' : 'block';
    if (tablePagination) tablePagination.style.display = show ? 'none' : 'block';
}

function showEmptyState(message) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const tableWrapper = document.getElementById('tableWrapper');
    const tablePagination = document.getElementById('tablePagination');
    const tbody = document.getElementById('tableBody');
    
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'block';
    if (tablePagination) tablePagination.style.display = 'none';
    
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;"><i class="fas fa-inbox" style="font-size: 2rem; opacity: 0.5; display: block; margin-bottom: 10px;"></i>' + message + '</td></tr>';
    }
}

// ============================================
// Registration Progress
// ============================================
function updateRegistrationProgress() {
    const today = new Date().toISOString().split('T')[0];
    const regCard = document.getElementById('regProgressCard');
    
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    
    const isViewingToday = (dateFrom === today && dateTo === today) || (!dateFrom && !dateTo);
    
    if (!isViewingToday) {
        if (regCard) regCard.style.display = 'none';
        return;
    }
    
    const regStats = getPatientRegistrationStats ? getPatientRegistrationStats() : {
        total: 0,
        registered: 0,
        pending: 0,
        percentComplete: 0
    };
    
    if (regCard) {
        regCard.style.display = regStats.total > 0 ? 'block' : 'none';
    }
    
    const regInfo = document.getElementById('regProgressInfo');
    const regPercent = document.getElementById('regProgressPercent');
    const regFill = document.getElementById('regProgressFill');
    const regDetail = document.getElementById('regStatusDetail');
    
    if (regInfo) regInfo.textContent = `${regStats.registered} of ${regStats.total} registered`;
    if (regPercent) regPercent.textContent = `${regStats.percentComplete}%`;
    if (regFill) regFill.style.width = `${regStats.percentComplete}%`;
    
    if (regFill) {
        if (regStats.percentComplete === 100) {
            regFill.className = 'progress-bar complete';
        } else {
            regFill.className = 'progress-bar';
        }
    }
    
    if (regDetail) {
        if (regStats.total === 0) {
            regDetail.textContent = 'No patients in queue';
            regDetail.style.color = 'rgba(255,255,255,0.5)';
        } else if (regStats.pending === 0) {
            regDetail.textContent = 'All patients registered! ✓';
            regDetail.style.color = 'rgba(144, 238, 144, 1)';
        } else if (regStats.pending === 1) {
            regDetail.textContent = '1 patient needs registration';
            regDetail.style.color = '#FFD700';
        } else {
            regDetail.textContent = `${regStats.pending} patients need registration`;
            regDetail.style.color = '#FFD700';
        }
    }
}

// ============================================
// Patient Selection from Dashboard
// ============================================
function checkForSelectedPatient() {
    const urlParams = new URLSearchParams(window.location.search);
    const selectedId = urlParams.get('patientId');
    
    if (selectedId) {
        const patientId = parseInt(selectedId);
        const patient = patientsData.find(function(p) { 
            return p.id === patientId; 
        });
        
        if (patient) {
            setTimeout(function() {
                openPatientModal(patientId);
                showToast('Patient #' + formatHashtag(patientId) + ' loaded from Dashboard');
            }, 500);
        }
    }
}

// ============================================
// Clock & Date Functions
// ============================================
function startClock() { 
    updateDateTime();
    setInterval(updateDateTime, 1000); 
}

function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeElement = document.getElementById('currentTime');
    if (timeElement) {
        timeElement.textContent = dateStr + ' | ' + timeStr;
    }
}

function initializeDates() {
    const today = new Date().toISOString().split('T')[0];
    const dateTo = document.getElementById('dateTo');
    const dateFrom = document.getElementById('dateFrom');
    if (dateTo) dateTo.value = today;
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (dateFrom) dateFrom.value = lastWeek;
}

// ============================================
// Utility Functions
// ============================================
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

function formatHashtag(id) {
    return '#' + String(id).padStart(4, '0');  // 4 digits format
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateFull(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function displayVital(value) {
    return value && value.trim() ? value : '-';
}

function parseVitalValue(value) {
    if (!value) return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

function parseBloodPressure(bpString) {
    if (!bpString) return { systolic: null, diastolic: null };
    const parts = bpString.split('/');
    if (parts.length !== 2) return { systolic: null, diastolic: null };
    return {
        systolic: parseFloat(parts[0]) || null,
        diastolic: parseFloat(parts[1]) || null
    };
}

function getVitalClass(type, value) {
    if (!value) return '';
    const numValue = parseVitalValue(value);
    if (numValue === null) return '';
    
    switch(type) {
        case 'temp':
            if (numValue < 35 || numValue > 39) return 'vital-critical';
            if (numValue < 36.1 || numValue > 37.2) return 'vital-abnormal';
            return 'vital-normal';
        case 'hr':
            if (numValue < 50 || numValue > 120) return 'vital-critical';
            if (numValue < 60 || numValue > 100) return 'vital-abnormal';
            return 'vital-normal';
        case 'o2':
            if (numValue < 92) return 'vital-critical';
            if (numValue < 95) return 'vital-abnormal';
            return 'vital-normal';
        default:
            return '';
    }
}

// ============================================
// Filter Functions
// ============================================
function applyFilters() {
    let hashtagInput = document.getElementById('searchHashtag').value.toLowerCase().trim();
    const name = document.getElementById('searchName').value.toLowerCase();
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    
    let hashtagNum = null;
    if (hashtagInput) {
        hashtagNum = validateHashtagInput(hashtagInput);
    }
    
    filteredData = patientsData.filter(function(patient) {
        let matchHashtag = true;
        if (hashtagNum !== null) {
            const patientNum = getHashtagNumber(patient.hashtag);
            matchHashtag = patientNum === hashtagNum;
        }
        
        const matchName = !name || (patient.name && patient.name.toLowerCase().includes(name));
        const patientDate = new Date(patient.date);
        const fromDate = dateFrom ? new Date(dateFrom) : null;
        const toDate = dateTo ? new Date(dateTo) : null;
        
        const matchDate = (!fromDate || patientDate >= fromDate) && 
                            (!toDate || patientDate <= toDate);
        
        return matchHashtag && matchName && matchDate;
    });
    
    currentPage = 1;
    renderTable();
    updateRegistrationProgress();
    showToast('Found ' + filteredData.length + ' records');
}

function clearFilters() {
    document.getElementById('searchHashtag').value = '';
    document.getElementById('searchName').value = '';
    initializeDates();
    filteredData = [...patientsData];
    currentPage = 1;
    renderTable();
    updateRegistrationProgress();
    showToast('Filters cleared');
}

function filterPendingOnly() {
    filteredData = patientsData.filter(function(patient) {
        return !hasPatientBeenRegistered || !hasPatientBeenRegistered(patient);
    });
    currentPage = 1;
    renderTable();
    showToast('Showing ' + filteredData.length + ' pending registrations');
}

function validateHashtagInput(input) {
    const cleanInput = input.replace('#', '');
    const num = parseInt(cleanInput);
    
    if (isNaN(num) || num < 0 || num > 9999) {  // 4-digit limit
        return null;
    }
    return num;
}

function getHashtagNumber(hashtagStr) {
    if (!hashtagStr) return null;
    const clean = hashtagStr.replace('#', '');
    return parseInt(clean);
}

// ============================================
// Table Rendering - Action column removed
// ============================================
function renderTable() {
    const tbody = document.getElementById('tableBody');
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageData = filteredData.slice(start, end);
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;"><i class="fas fa-inbox" style="font-size: 2rem; opacity: 0.5; display: block; margin-bottom: 10px;"></i>No records found</td></tr>';
    } else {
        pageData.forEach(function(patient) {
            const formattedHashtag = formatHashtag(patient.id);
            const displayName = patient.name && patient.name.trim() ? patient.name : '-';
            
            const isRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(patient) : true;
            
            const temp = displayVital(patient.vitals.temperature);
            const hr = displayVital(patient.vitals.heartRate);
            const bp = displayVital(patient.vitals.bloodPressure);
            const o2 = displayVital(patient.vitals.oxygenSat);
            
            const tempClass = getVitalClass('temp', patient.vitals.temperature);
            const hrClass = getVitalClass('hr', patient.vitals.heartRate);
            const o2Class = getVitalClass('o2', patient.vitals.oxygenSat);
            
            const row = document.createElement('tr');
            row.onclick = function() { openPatientModal(patient.id); };
            
            const statusIcon = patient.status === 'stable' ? 'check-circle' : 'exclamation-triangle';
            const statusText = patient.status.charAt(0).toUpperCase() + patient.status.slice(1);
            
            const regStatusHtml = isRegistered 
                ? '<span class="badge-registered"><i class="fas fa-check"></i> Registered</span>'
                : '<span class="badge-pending"><i class="fas fa-exclamation-circle"></i> Pending</span>';
            
            // Action column removed - now 7 columns instead of 8
            row.innerHTML = 
                '<td><strong>' + formattedHashtag + '</strong></td>' +
                '<td>' + formatDate(patient.date) + '</td>' +
                '<td>' + patient.time + '</td>' +
                '<td>' + displayName + '</td>' +
                '<td>' +
                    '<div class="vitals-preview">' +
                        '<span class="vital-mini ' + tempClass + '"><i class="fas fa-thermometer-half"></i> ' + temp + '</span>' +
                        '<span class="vital-mini ' + hrClass + '"><i class="fas fa-heart"></i> ' + hr + '</span>' +
                        '<span class="vital-mini"><i class="fas fa-tint"></i> ' + bp + '</span>' +
                        '<span class="vital-mini ' + o2Class + '"><i class="fas fa-lungs"></i> ' + o2 + '</span>' +
                    '</div>' +
                '</td>' +
                '<td>' +
                    '<span class="badge-' + patient.status + '">' +
                        '<i class="fas fa-' + statusIcon + '"></i> ' + statusText +
                    '</span>' +
                '</td>' +
                '<td>' + regStatusHtml + '</td>';
            
            tbody.appendChild(row);
        });
    }
    
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    document.getElementById('pageInfo').textContent = 'Page ' + currentPage + ' of ' + (totalPages || 1);
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage >= totalPages || totalPages === 0;
    document.getElementById('totalRecords').textContent = filteredData.length + ' Records';
}

// ============================================
// Pagination
// ============================================
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
    }
}

function nextPage() {
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderTable();
    }
}

// ============================================
// Statistics
// ============================================
function updateStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayPatients = patientsData.filter(function(p) { return p.date === today; });
    
    document.getElementById('todayCount').textContent = todayPatients.length;
    document.getElementById('stableCount').textContent = patientsData.filter(function(p) { return p.status === 'stable'; }).length;
    document.getElementById('unstableCount').textContent = patientsData.filter(function(p) { return p.status === 'unstable'; }).length;
}

// ============================================
// Patient Modal Functions
// ============================================
function openPatientModal(patientId) {
    currentPatient = patientsData.find(function(p) { return p.id === patientId; });
    if (!currentPatient) return;
    
    updatePatientStatus(currentPatient);
    
    const formattedHashtag = formatHashtag(currentPatient.id);
    
    document.getElementById('modalHashtag').textContent = formattedHashtag;
    document.getElementById('modalDate').textContent = formatDate(currentPatient.date) + ' | ' + currentPatient.time;
    
    document.getElementById('modalName').value = currentPatient.name || '';
    document.getElementById('modalSchoolId').value = currentPatient.schoolId || '';
    document.getElementById('modalAge').value = currentPatient.age || '';
    document.getElementById('modalGender').value = currentPatient.gender || '';
    document.getElementById('modalGrade').value = currentPatient.grade || '';
    document.getElementById('modalContact').value = currentPatient.contact || '';
    document.getElementById('modalBP').value = currentPatient.vitals.bloodPressure || '';
    document.getElementById('modalComplaint').value = currentPatient.complaint || '';
    document.getElementById('modalNotes').value = currentPatient.notes || '';
    
    document.getElementById('modalTemp').textContent = displayVital(currentPatient.vitals.temperature);
    document.getElementById('modalHeartRate').textContent = displayVital(currentPatient.vitals.heartRate);
    document.getElementById('modalO2').textContent = displayVital(currentPatient.vitals.oxygenSat);
    
    updateVitalCardClasses();
    
    const statusBadge = document.getElementById('modalStatusBadge');
    statusBadge.className = 'profile-status ' + currentPatient.status;
    const statusIcon = currentPatient.status === 'stable' ? 'check-circle' : 'exclamation-triangle';
    statusBadge.innerHTML = '<i class="fas fa-' + statusIcon + '"></i> ' + (currentPatient.status ? currentPatient.status.toUpperCase() : 'UNKNOWN');
    
    const statusReason = document.getElementById('modalStatusReason');
    if (statusReason) {
        if (currentPatient.stabilityReason && currentPatient.status === 'unstable') {
            statusReason.textContent = currentPatient.stabilityReason;
            statusReason.style.display = 'block';
            statusReason.className = 'status-reason critical';
        } else if (currentPatient.stabilityReason && currentPatient.status === 'stable') {
            statusReason.textContent = currentPatient.stabilityReason;
            statusReason.style.display = 'block';
            statusReason.className = 'status-reason';
        } else {
            statusReason.style.display = 'none';
        }
    }
    
    const regStatusBadge = document.getElementById('modalRegStatus');
    if (regStatusBadge) {
        const isRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(currentPatient) : true;
        if (!isRegistered) {
            regStatusBadge.style.display = 'inline-flex';
        } else {
            regStatusBadge.style.display = 'none';
        }
    }
    
    document.getElementById('patientModal').style.display = 'block';
}

function updateVitalCardClasses() {
    if (!currentPatient) return;
    
    const tempCard = document.getElementById('tempCard');
    const tempVal = parseVitalValue(currentPatient.vitals.temperature);
    tempCard.className = 'vital-card';
    if (tempVal !== null) {
        if (tempVal < 35 || tempVal > 39) tempCard.classList.add('critical');
        else if (tempVal < 36.1 || tempVal > 37.2) tempCard.classList.add('abnormal');
        else tempCard.classList.add('normal');
    }
    
    const hrCard = document.getElementById('hrCard');
    const hrVal = parseVitalValue(currentPatient.vitals.heartRate);
    hrCard.className = 'vital-card';
    if (hrVal !== null) {
        if (hrVal < 50 || hrVal > 120) hrCard.classList.add('critical');
        else if (hrVal < 60 || hrVal > 100) hrCard.classList.add('abnormal');
        else hrCard.classList.add('normal');
    }
    
    const bpCard = document.getElementById('bpCard');
    const bp = parseBloodPressure(currentPatient.vitals.bloodPressure);
    bpCard.className = 'vital-card';
    if (bp.systolic !== null && bp.diastolic !== null) {
        if (bp.systolic > 180 || bp.systolic < 90 || bp.diastolic > 120 || bp.diastolic < 60) {
            bpCard.classList.add('critical');
        } else if (bp.systolic > 120 || bp.systolic < 90 || bp.diastolic > 80 || bp.diastolic < 60) {
            bpCard.classList.add('abnormal');
        } else {
            bpCard.classList.add('normal');
        }
    }
    
    const o2Card = document.getElementById('o2Card');
    const o2Val = parseVitalValue(currentPatient.vitals.oxygenSat);
    o2Card.className = 'vital-card';
    if (o2Val !== null) {
        if (o2Val < 92) o2Card.classList.add('critical');
        else if (o2Val < 95) o2Card.classList.add('abnormal');
        else o2Card.classList.add('normal');
    }
}

function closeModal() {
    document.getElementById('patientModal').style.display = 'none';
    currentPatient = null;
}

// ============================================
// Save and Update Functions
// ============================================
async function savePatientDetails() {
    if (!currentPatient) return;
    
    const wasRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(currentPatient) : false;
    
    const name = document.getElementById('modalName').value.trim();
    const schoolId = document.getElementById('modalSchoolId').value.trim();
    const age = parseInt(document.getElementById('modalAge').value) || '';
    const gender = document.getElementById('modalGender').value;
    const grade = document.getElementById('modalGrade').value.trim();
    const contact = document.getElementById('modalContact').value.trim();
    const bloodPressure = document.getElementById('modalBP').value.trim();
    const complaint = document.getElementById('modalComplaint').value.trim();
    const notes = document.getElementById('modalNotes').value.trim();
    
    currentPatient.name = name;
    currentPatient.schoolId = schoolId;
    currentPatient.age = age;
    currentPatient.gender = gender;
    currentPatient.grade = grade;
    currentPatient.contact = contact;
    currentPatient.vitals.bloodPressure = bloodPressure;
    currentPatient.complaint = complaint;
    currentPatient.notes = notes;
    
    updatePatientStatus(currentPatient);
    
    const saved = await savePatientToDB(currentPatient);
    if (!saved) {
        showToast('Failed to save', 'critical');
        return;
    }
    
    const isNowRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(currentPatient) : false;
    
    if (!wasRegistered && isNowRegistered) {
        showToast('Patient registered! Queue progress updated.');
    } else {
        const statusMsg = currentPatient.status === 'unstable' 
            ? 'Saved! Status: UNSTABLE - ' + currentPatient.stabilityReason
            : 'Patient details saved successfully';
        showToast(statusMsg);
    }
    
    renderTable();
    updateStats();
    updateRegistrationProgress();
    closeModal();
}

// ============================================
// Excuse Letter Printing (Updated Format)
// ============================================

function printExcuseLetter() {
    if (!currentPatient) {
        showToast('No patient selected', 'critical');
        return;
    }
    
    populateExcuseLetterData();
    
    setTimeout(function() {
        window.print();
    }, 100);
}

function populateExcuseLetterData() {
    const patient = currentPatient;
    
    // Student Information
    document.getElementById('printStudentName').textContent = 
        patient.name && patient.name.trim() ? patient.name : '_________________________';
    
    document.getElementById('printStudentId').textContent = 
        patient.schoolId && patient.schoolId.trim() ? patient.schoolId : '_________________________';
    
    document.getElementById('printStudentAge').textContent = 
        patient.age ? patient.age : '_________________________';
    
    document.getElementById('printStudentGender').textContent = 
        patient.gender && patient.gender.trim() ? patient.gender : '_________________________';
    
    // Clinic Visit Details
    document.getElementById('printVisitDate').textContent = 
        formatDateFull(patient.date) || '_________________________';
    
    document.getElementById('printVisitTime').textContent = 
        patient.time || '_________________________';
    
    document.getElementById('printComplaint').textContent = 
        patient.complaint && patient.complaint.trim() ? patient.complaint : '_________________________';
}

// ============================================
// Export and Utility Functions
// ============================================
async function refreshTable() {
    const btn = document.querySelector('.btn-icon[onclick="refreshTable()"]');
    if (btn) btn.classList.add('refreshing');
    
    showLoading(true);
    
    const loaded = await loadPatientsFromDB();
    
    if (loaded) {
        filteredData = [...patientsData];
        updateStats();
        updateRegistrationProgress();
        renderTable();
        showToast('Table refreshed with latest data');
    } else {
        showToast('Failed to refresh data', 'critical');
    }
    
    showLoading(false);
    if (btn) btn.classList.remove('refreshing');
}

function exportData() {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const hashtagFilter = document.getElementById('searchHashtag').value.trim();
    const nameFilter = document.getElementById('searchName').value.trim().toLowerCase();
    
    let dataToExport = [];
    
    if (dateFrom || dateTo || hashtagFilter || nameFilter) {
        dataToExport = [...filteredData];
    } else {
        dataToExport = [...patientsData];
    }
    
    dataToExport.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (dataToExport.length === 0) {
        showToast('No data to export. Please check your filters.', 'warning');
        return;
    }
    
    const excelData = dataToExport.map(p => ({
        'Hashtag #': formatHashtag(p.id),
        'Date': formatDateForExcel(p.date),
        'Time': p.time || '-',
        'Patient Name': p.name && p.name.trim() ? p.name : 'NOT REGISTERED',
        'School ID': p.schoolId || '-',
        'Age': p.age || '-',
        'Gender': p.gender || '-',
        'Course/Year/Section': p.grade || '-',
        'Contact': p.contact || '-',
        'Status': p.status ? p.status.toUpperCase() : 'UNKNOWN',
        'Stability Reason': p.stabilityReason || '-',
        'Temperature (°C)': p.vitals.temperature || '-',
        'Heart Rate (bpm)': p.vitals.heartRate || '-',
        'Blood Pressure': p.vitals.bloodPressure || '-',
        'Oxygen Saturation (%)': p.vitals.oxygenSat || '-',
        'Symptoms/Complaint': p.complaint || '-',
        'Nurse Notes': p.notes || '-',
        'Registration Status': (hasPatientBeenRegistered && hasPatientBeenRegistered(p)) ? 'REGISTERED' : 'PENDING'
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    const colWidths = [
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 25 }, { wch: 15 },
        { wch: 8 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 12 },
        { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 40 }, { wch: 40 }, { wch: 15 }
    ];
    ws['!cols'] = colWidths;
    
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!ws[cellAddress]) continue;
        
        ws[cellAddress].s = {
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
            fill: { fgColor: { rgb: "006400" }, patternType: 'solid' },
            alignment: { horizontal: "center", vertical: "center" },
            border: {
                top: { style: "thin", color: { rgb: "90EE90" } },
                bottom: { style: "thin", color: { rgb: "90EE90" } },
                left: { style: "thin", color: { rgb: "90EE90" } },
                right: { style: "thin", color: { rgb: "90EE90" } }
            }
        };
    }
    
    ws['!rows'] = [{ hpt: 25 }];
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
    
    XLSX.utils.book_append_sheet(wb, ws, "Patient Records");
    
    let filename = generateExportFilename(dateFrom, dateTo);
    
    try {
        XLSX.writeFile(wb, filename);
        showToast(`Exported ${dataToExport.length} records to ${filename}`);
    } catch (error) {
        console.error('Export error:', error);
        showToast('Export failed. Please try again.', 'critical');
    }
}

function formatDateForExcel(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function generateExportFilename(dateFrom, dateTo) {
    const today = new Date().toISOString().split('T')[0];
    
    if (!dateFrom && !dateTo) {
        return `Patient_History_All_Records_${today}.xlsx`;
    }
    
    const fromStr = dateFrom ? dateFrom.replace(/-/g, '') : 'START';
    const toStr = dateTo ? dateTo.replace(/-/g, '') : 'TODAY';
    
    if (dateFrom === dateTo) {
        return `Patient_History_${dateFrom}.xlsx`;
    }
    
    return `Patient_History_${fromStr}_to_${toStr}.xlsx`;
}

// ============================================
// Sign Out Functions
// ============================================
function showSignOutModal() { 
    const modal = document.getElementById('signOutModal');
    if (modal) {
        modal.style.display = 'flex'; // Use flex for centering
    }
}

function hideSignOutModal() { 
    const modal = document.getElementById('signOutModal');
    if (modal) {
        modal.style.display = 'none'; 
    }
}

async function confirmSignOut() {
    if (typeof logoutAdmin === 'function') {
        await logoutAdmin();
    } else {
        window.location.href = "login.html";
    }
}

// ============================================
// Toast Notification
// ============================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = toast.querySelector('i');
    
    toastMessage.textContent = message;
    toast.className = 'toast';
    
    switch(type) {
        case 'warning':
            toast.classList.add('warning');
            toastIcon.className = 'fas fa-exclamation-triangle';
            break;
        case 'critical':
            toastIcon.className = 'fas fa-exclamation-circle';
            break;
        default:
            toastIcon.className = 'fas fa-check-circle';
    }
    
    toast.classList.add('show');
    
    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() {
            toastIcon.className = 'fas fa-check-circle';
        }, 300);
    }, 3000);
}