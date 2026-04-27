// ============================================
// SCHOOL CLINIC PATIENT HISTORY SYSTEM
// Uses Supabase database for patient data storage
// ============================================

// State Management
let filteredData = [];
let currentPage = 1;
const itemsPerPage = 16;  // 16 rows per page for better fit
let currentPatient = null;
let isDataLoaded = false;
let autoSaveTimer = null;
let selectedTemplateType = null;

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
    setupModalCloseHandlers();
    setupModalFieldListeners();
    setupTemplatePickerCloseHandler();
});

// ============================================
// Event Listeners Setup
// ============================================
function setupEventListeners() {
    // Sign Out Modal
    const signOutBtn = document.getElementById('signOutBtn');
    const cancelSignOut = document.getElementById('cancelSignOut');
    const confirmSignOutBtn = document.getElementById('confirmSignOut') || document.getElementById('SignOut');

    if (signOutBtn) signOutBtn.addEventListener('click', showSignOutModal);
    if (cancelSignOut) cancelSignOut.addEventListener('click', hideSignOutModal);
    if (confirmSignOutBtn) confirmSignOutBtn.addEventListener('click', confirmSignOut);

    // Search inputs
    const searchHashtag = document.getElementById('searchHashtag');
    const searchName = document.getElementById('searchName');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');

    if (searchHashtag) searchHashtag.addEventListener('input', debounce(applyFilters, 300));
    if (searchName) searchName.addEventListener('input', debounce(applyFilters, 300));
    if (dateFrom) dateFrom.addEventListener('change', applyFilters);
    if (dateTo) dateTo.addEventListener('change', applyFilters);

    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideSignOutModal();
            closeTemplatePicker();
            closeModal();
        }
    });
}

// ============================================
// NEW: Modal Field Listeners for Real-time Validation
// ============================================
function setupModalFieldListeners() {
    // Real-time validation and auto-save indicator
    const fields = ['modalName', 'modalSchoolId', 'modalAge', 'modalGrade', 'modalContact', 'modalBP', 'modalComplaint', 'modalNotes', 'modalGuardian', 'modalAddress', 'modalBirthdate', 'modalManagement'];

    fields.forEach(function(fieldId) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', function() {
                // Remove error state on input
                this.classList.remove('error');

                // Force uppercase for name field in real-time
                if (this.id === 'modalName') {
                    this.value = this.value.toUpperCase();
                }

                // Show auto-save indicator
                showAutoSaveIndicator();

                // Clear existing timer
                if (autoSaveTimer) clearTimeout(autoSaveTimer);

                // Set new timer for auto-save visual feedback
                autoSaveTimer = setTimeout(function() {
                    hideAutoSaveIndicator();
                }, 1000);
            });

            // Validate on blur
            field.addEventListener('blur', function() {
                validateField(this);
            });
        }
    });
}

function showAutoSaveIndicator() {
    const indicator = document.getElementById('autoSaveIndicator');
    if (indicator) indicator.classList.add('show');
}

function hideAutoSaveIndicator() {
    const indicator = document.getElementById('autoSaveIndicator');
    if (indicator) indicator.classList.remove('show');
}

function validateField(field) {
    const value = field.value.trim();

    // Name validation
    if (field.id === 'modalName') {
        if (!value) {
            field.classList.add('error');
            return false;
        }
        // Check format: Surname, First Name, Middle Name
        const parts = value.split(',').map(function(p) { return p.trim(); });
        if (parts.length < 2) {
            field.classList.add('error');
            return false;
        }
    }

    // Age validation
    if (field.id === 'modalAge') {
        const age = parseInt(value);
        if (value && (isNaN(age) || age < 1 || age > 120)) {
            field.classList.add('error');
            return false;
        }
    }

    // Blood pressure validation
    if (field.id === 'modalBP') {
        if (value && !/^\d{2,3}\/\d{2,3}$/.test(value)) {
            field.classList.add('error');
            return false;
        }
    }

    // School ID validation
    if (field.id === 'modalSchoolId') {
        if (value && value.length < 3) {
            field.classList.add('error');
            return false;
        }
    }

    field.classList.remove('error');
    field.classList.add('success');
    setTimeout(function() {
        field.classList.remove('success');
    }, 2000);

    return true;
}

// ============================================
// Robust Modal Close Handlers
// ============================================
function setupModalCloseHandlers() {
    // Sign Out Modal - close when clicking outside
    const signOutModal = document.getElementById('signOutModal');
    if (signOutModal) {
        signOutModal.addEventListener('click', function(e) {
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
                // Check for unsaved changes before closing
                if (hasUnsavedChanges()) {
                    if (!confirm('You have unsaved changes. Close anyway?')) {
                        return;
                    }
                }
                closeModal();
            }
        });
    }
}

// ============================================
// Template Picker Close Handler
// ============================================
function setupTemplatePickerCloseHandler() {
    const pickerModal = document.getElementById('templatePickerModal');
    if (pickerModal) {
        pickerModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeTemplatePicker();
            }
        });
    }
}

// ============================================
// Check for Unsaved Changes
// ============================================
function hasUnsavedChanges() {
    if (!currentPatient) return false;

    const modalName = document.getElementById('modalName');
    const modalSchoolId = document.getElementById('modalSchoolId');
    const modalAge = document.getElementById('modalAge');
    const modalGender = document.getElementById('modalGender');
    const modalGrade = document.getElementById('modalGrade');
    const modalContact = document.getElementById('modalContact');
    const modalBP = document.getElementById('modalBP');
    const modalComplaint = document.getElementById('modalComplaint');
    const modalNotes = document.getElementById('modalNotes');
    const modalGuardian = document.getElementById('modalGuardian');
    const modalAddress = document.getElementById('modalAddress');
    const modalBirthdate = document.getElementById('modalBirthdate');
    const modalManagement = document.getElementById('modalManagement');

    const currentValues = {
        name: modalName ? modalName.value.trim() : '',
        schoolId: modalSchoolId ? modalSchoolId.value.trim() : '',
        age: modalAge ? modalAge.value : '',
        gender: modalGender ? modalGender.value : '',
        grade: modalGrade ? modalGrade.value.trim() : '',
        contact: modalContact ? modalContact.value.trim() : '',
        bloodPressure: modalBP ? modalBP.value.trim() : '',
        complaint: modalComplaint ? modalComplaint.value.trim() : '',
        notes: modalNotes ? modalNotes.value.trim() : '',
        guardian: modalGuardian ? modalGuardian.value.trim() : '',
        address: modalAddress ? modalAddress.value.trim() : '',
        birthdate: modalBirthdate ? modalBirthdate.value : '',
        management: modalManagement ? modalManagement.value.trim() : ''
    };

    const originalValues = {
        name: currentPatient.name || '',
        schoolId: currentPatient.schoolId || '',
        age: currentPatient.age || '',
        gender: currentPatient.gender || '',
        grade: currentPatient.grade || '',
        contact: currentPatient.contact || '',
        bloodPressure: currentPatient.vitals.bloodPressure || '',
        complaint: currentPatient.complaint || '',
        notes: currentPatient.notes || '',
        guardian: currentPatient.guardian || '',
        address: currentPatient.address || '',
        birthdate: currentPatient.birthdate || '',
        management: currentPatient.management || ''
    };

    return JSON.stringify(currentValues) !== JSON.stringify(originalValues);
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
    const today = getTodayDate();
    const regCard = document.getElementById('regProgressCard');

    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    const dateFromVal = dateFrom ? dateFrom.value : '';
    const dateToVal = dateTo ? dateTo.value : '';

    const isViewingToday = (dateFromVal === today && dateToVal === today) || (!dateFromVal && !dateToVal);

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
            }, 500);
        }
    }
}

// ============================================
// Clock & Date Functions - REALTIME PHILIPPINE TIME
// ============================================
function startClock() { 
    updateDateTime();
    setInterval(updateDateTime, 1000); 
}

function updateDateTime() {
    const timestamp = getPhilippineTimestamp ? getPhilippineTimestamp() : {
        date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    };

    const timeElement = document.getElementById('currentTime');
    if (timeElement) {
        timeElement.textContent = timestamp.date + ' | ' + timestamp.time;
    }
}

function initializeDates() {
    const today = getTodayDate ? getTodayDate() : new Date().toISOString().split('T')[0];
    const dateTo = document.getElementById('dateTo');
    const dateFrom = document.getElementById('dateFrom');
    if (dateTo) dateTo.value = today;

    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastWeekStr = lastWeek.toISOString().split('T')[0];
    if (dateFrom) dateFrom.value = lastWeekStr;
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

function formatHashtagDisplay(hashtag) {
    if (typeof window.formatHashtag === 'function') {
        return window.formatHashtag(hashtag);
    }
    if (!hashtag) return '#000';
    const num = parseInt(hashtag.replace('#', ''));
    if (isNaN(num)) return '#000';
    return '#' + String(num).padStart(3, '0');
}

function getHashtagNumber(hashtagStr) {
    if (!hashtagStr) return null;
    const clean = hashtagStr.replace('#', '');
    const num = parseInt(clean);
    return isNaN(num) ? null : num;
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
// NEW: Update Patient Status Based on Current Vitals
// ============================================
function updatePatientStatus(patient) {
    if (!patient || !patient.vitals) return;

    const temp = parseVitalValue(patient.vitals.temperature);
    const hr = parseVitalValue(patient.vitals.heartRate);
    const o2 = parseVitalValue(patient.vitals.oxygenSat);
    const bp = parseBloodPressure(patient.vitals.bloodPressure);

    let status = 'stable';
    let reasons = [];

    // Temperature check
    if (temp !== null) {
        if (temp >= 38) {
            status = 'unstable';
            reasons.push(`Fever: ${temp}°C`);
        } else if (temp < 36) {
            status = 'unstable';
            reasons.push(`Hypothermia: ${temp}°C`);
        }
    }

    // Heart rate check
    if (hr !== null) {
        if (hr < 50) {
            status = 'unstable';
            reasons.push(`Bradycardia: ${hr} bpm`);
        } else if (hr > 120) {
            status = 'unstable';
            reasons.push(`Tachycardia: ${hr} bpm`);
        }
    }

    // Oxygen saturation check
    if (o2 !== null && o2 < 95) {
        status = 'unstable';
        reasons.push(`Low O₂: ${o2}%`);
    }

    // Blood pressure check
    if (bp.systolic !== null && bp.diastolic !== null) {
        if (bp.systolic > 180 || bp.diastolic > 120) {
            status = 'unstable';
            reasons.push(`Hypertensive crisis: ${bp.systolic}/${bp.diastolic}`);
        } else if (bp.systolic < 90 || bp.diastolic < 60) {
            status = 'unstable';
            reasons.push(`Hypotension: ${bp.systolic}/${bp.diastolic}`);
        }
    }

    patient.status = status;
    patient.stabilityReason = reasons.length > 0 ? reasons.join('; ') : 'All vitals within normal range';
}

// ============================================
// Filter Functions
// ============================================
function applyFilters() {
    const hashtagInputEl = document.getElementById('searchHashtag');
    const nameEl = document.getElementById('searchName');
    const dateFromEl = document.getElementById('dateFrom');
    const dateToEl = document.getElementById('dateTo');

    let hashtagInput = hashtagInputEl ? hashtagInputEl.value.toLowerCase().trim() : '';
    const name = nameEl ? nameEl.value.toLowerCase() : '';
    const dateFrom = dateFromEl ? dateFromEl.value : '';
    const dateTo = dateToEl ? dateToEl.value : '';

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
        const patientDate = patient.date;
        const fromDate = dateFrom ? dateFrom : null;
        const toDate = dateTo ? dateTo : null;

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
    const searchHashtag = document.getElementById('searchHashtag');
    const searchName = document.getElementById('searchName');

    if (searchHashtag) searchHashtag.value = '';
    if (searchName) searchName.value = '';
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

    if (isNaN(num) || num < 0 || num > 999) {
        return null;
    }
    return num;
}

// ============================================
// Table Rendering
// ============================================
function renderTable() {
    const tbody = document.getElementById('tableBody');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const totalRecords = document.getElementById('totalRecords');

    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageData = filteredData.slice(start, end);

    if (!tbody) return;

    tbody.innerHTML = '';

    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;"><i class="fas fa-inbox" style="font-size: 2rem; opacity: 0.5; display: block; margin-bottom: 10px;"></i>No records found</td></tr>';
    } else {
        pageData.forEach(function(patient) {
            const formattedHashtag = typeof window.formatHashtag === 'function' 
                ? window.formatHashtag(patient.hashtag) 
                : formatHashtagDisplay(patient.hashtag);

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
            row.style.cursor = 'pointer';
            row.onclick = function() { openPatientModal(patient.id); };

            const statusIcon = patient.status === 'stable' ? 'check-circle' : 'exclamation-triangle';
            const statusText = patient.status.charAt(0).toUpperCase() + patient.status.slice(1);

            const regStatusHtml = isRegistered 
                ? '<span class="badge-registered"><i class="fas fa-check"></i> Registered</span>'
                : '<span class="badge-pending"><i class="fas fa-exclamation-circle"></i> Pending</span>';

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
    if (pageInfo) pageInfo.textContent = 'Page ' + currentPage + ' of ' + (totalPages || 1);
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages || totalPages === 0;
    if (totalRecords) totalRecords.textContent = filteredData.length + ' Records';
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
    const today = getTodayDate ? getTodayDate() : new Date().toISOString().split('T')[0];
    const todayPatients = patientsData.filter(function(p) { return p.date === today; });

    const todayCount = document.getElementById('todayCount');
    const stableCount = document.getElementById('stableCount');
    const unstableCount = document.getElementById('unstableCount');

    if (todayCount) todayCount.textContent = todayPatients.length;
    if (stableCount) stableCount.textContent = patientsData.filter(function(p) { return p.status === 'stable'; }).length;
    if (unstableCount) unstableCount.textContent = patientsData.filter(function(p) { return p.status === 'unstable'; }).length;
}

// ============================================
// Patient Modal Functions - ENHANCED
// ============================================
function openPatientModal(patientId) {
    currentPatient = patientsData.find(function(p) { return p.id === patientId; });
    if (!currentPatient) return;

    // Update patient status based on current vitals before opening
    updatePatientStatus(currentPatient);

    const formattedHashtag = typeof window.formatHashtag === 'function' 
        ? window.formatHashtag(currentPatient.hashtag) 
        : formatHashtagDisplay(currentPatient.hashtag);

    // Get all modal elements
    const elements = {
        modalHashtag: document.getElementById('modalHashtag'),
        modalDate: document.getElementById('modalDate'),
        modalName: document.getElementById('modalName'),
        modalSchoolId: document.getElementById('modalSchoolId'),
        modalAge: document.getElementById('modalAge'),
        modalGender: document.getElementById('modalGender'),
        modalGrade: document.getElementById('modalGrade'),
        modalContact: document.getElementById('modalContact'),
        modalGuardian: document.getElementById('modalGuardian'),
        modalAddress: document.getElementById('modalAddress'),
        modalBirthdate: document.getElementById('modalBirthdate'),
        modalBP: document.getElementById('modalBP'),
        modalComplaint: document.getElementById('modalComplaint'),
        modalNotes: document.getElementById('modalNotes'),
        modalManagement: document.getElementById('modalManagement'),
        modalTemp: document.getElementById('modalTemp'),
        modalHeartRate: document.getElementById('modalHeartRate'),
        modalO2: document.getElementById('modalO2'),
        patientModal: document.getElementById('patientModal'),
        modalStatusBadge: document.getElementById('modalStatusBadge'),
        modalStatusReason: document.getElementById('modalStatusReason'),
        modalRegStatus: document.getElementById('modalRegStatus')
    };

    // Populate all fields with null checks
    if (elements.modalHashtag) elements.modalHashtag.textContent = formattedHashtag;
    if (elements.modalDate) elements.modalDate.textContent = formatDate(currentPatient.date) + ' | ' + currentPatient.time;
    // Ensure name is always uppercase when opening modal
    if (elements.modalName) elements.modalName.value = (currentPatient.name || '').toUpperCase();
    if (elements.modalSchoolId) elements.modalSchoolId.value = currentPatient.schoolId || '';
    if (elements.modalAge) elements.modalAge.value = currentPatient.age || '';
    if (elements.modalGender) elements.modalGender.value = currentPatient.gender || '';
    if (elements.modalGrade) elements.modalGrade.value = currentPatient.grade || '';
    if (elements.modalContact) elements.modalContact.value = currentPatient.contact || '';
    if (elements.modalGuardian) elements.modalGuardian.value = currentPatient.guardian || '';
    if (elements.modalAddress) elements.modalAddress.value = currentPatient.address || '';
    if (elements.modalBirthdate) elements.modalBirthdate.value = currentPatient.birthdate || '';
    if (elements.modalBP) elements.modalBP.value = currentPatient.vitals.bloodPressure || '';
    if (elements.modalComplaint) elements.modalComplaint.value = currentPatient.complaint || '';
    if (elements.modalNotes) elements.modalNotes.value = currentPatient.notes || '';
    if (elements.modalManagement) elements.modalManagement.value = currentPatient.management || '';
    if (elements.modalTemp) elements.modalTemp.textContent = displayVital(currentPatient.vitals.temperature);
    if (elements.modalHeartRate) elements.modalHeartRate.textContent = displayVital(currentPatient.vitals.heartRate);
    if (elements.modalO2) elements.modalO2.textContent = displayVital(currentPatient.vitals.oxygenSat);

    // Update visual elements
    updateVitalCardClasses();
    updateModalStatusDisplay(elements);
    updateRegistrationBadge(elements);

    // Clear any previous validation states
    document.querySelectorAll('.editable-field').forEach(function(field) {
        field.classList.remove('error', 'success');
    });

    // Show modal with flex for proper centering
    if (elements.patientModal) {
        elements.patientModal.style.display = 'flex';
        elements.patientModal.classList.add('show');
    }
}

function updateModalStatusDisplay(elements) {
    if (!currentPatient) return;

    const statusBadge = elements.modalStatusBadge || document.getElementById('modalStatusBadge');
    const statusReason = elements.modalStatusReason || document.getElementById('modalStatusReason');

    if (statusBadge) {
        statusBadge.className = 'profile-status ' + currentPatient.status;
        const statusIcon = currentPatient.status === 'stable' ? 'check-circle' : 'exclamation-triangle';
        statusBadge.innerHTML = '<i class="fas fa-' + statusIcon + '"></i> ' + 
            (currentPatient.status ? currentPatient.status.toUpperCase() : 'UNKNOWN');
    }

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
}

function updateRegistrationBadge(elements) {
    const regStatusBadge = elements.modalRegStatus || document.getElementById('modalRegStatus');
    if (!regStatusBadge) return;

    const isRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(currentPatient) : true;

    if (!isRegistered) {
        regStatusBadge.style.display = 'inline-flex';
        regStatusBadge.className = 'reg-status-badge';
        regStatusBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Needs Registration';
    } else {
        regStatusBadge.style.display = 'inline-flex';
        regStatusBadge.className = 'reg-status-badge registered';
        regStatusBadge.innerHTML = '<i class="fas fa-check-circle"></i> Registered';
    }
}

function updateVitalCardClasses() {
    if (!currentPatient) return;

    const cards = {
        tempCard: document.getElementById('tempCard'),
        hrCard: document.getElementById('hrCard'),
        bpCard: document.getElementById('bpCard'),
        o2Card: document.getElementById('o2Card')
    };

    // Temperature
    if (cards.tempCard) {
        const tempVal = parseVitalValue(currentPatient.vitals.temperature);
        cards.tempCard.className = 'vital-card';
        if (tempVal !== null) {
            if (tempVal < 35 || tempVal > 39) cards.tempCard.classList.add('critical');
            else if (tempVal < 36.1 || tempVal > 37.2) cards.tempCard.classList.add('abnormal');
            else cards.tempCard.classList.add('normal');
        }
    }

    // Heart Rate
    if (cards.hrCard) {
        const hrVal = parseVitalValue(currentPatient.vitals.heartRate);
        cards.hrCard.className = 'vital-card';
        if (hrVal !== null) {
            if (hrVal < 50 || hrVal > 120) cards.hrCard.classList.add('critical');
            else if (hrVal < 60 || hrVal > 100) cards.hrCard.classList.add('abnormal');
            else cards.hrCard.classList.add('normal');
        }
    }

    // Blood Pressure
    if (cards.bpCard) {
        const bp = parseBloodPressure(currentPatient.vitals.bloodPressure);
        cards.bpCard.className = 'vital-card';
        if (bp.systolic !== null && bp.diastolic !== null) {
            if (bp.systolic > 180 || bp.systolic < 90 || bp.diastolic > 120 || bp.diastolic < 60) {
                cards.bpCard.classList.add('critical');
            } else if (bp.systolic > 120 || bp.systolic < 90 || bp.diastolic > 80 || bp.diastolic < 60) {
                cards.bpCard.classList.add('abnormal');
            } else {
                cards.bpCard.classList.add('normal');
            }
        }
    }

    // Oxygen Saturation
    if (cards.o2Card) {
        const o2Val = parseVitalValue(currentPatient.vitals.oxygenSat);
        cards.o2Card.className = 'vital-card';
        if (o2Val !== null) {
            if (o2Val < 92) cards.o2Card.classList.add('critical');
            else if (o2Val < 95) cards.o2Card.classList.add('abnormal');
            else cards.o2Card.classList.add('normal');
        }
    }
}

// ============================================
// UPDATED: Smooth Modal Close with Animation
// ============================================
function closeModal() {
    const patientModal = document.getElementById('patientModal');

    if (patientModal) {
        // Add closing class for exit animation
        patientModal.classList.add('closing');
        patientModal.classList.remove('show');

        // Wait for animation to finish before hiding
        setTimeout(function() {
            patientModal.style.display = 'none';
            patientModal.classList.remove('closing');

            // Clear validation states after modal is hidden
            document.querySelectorAll('.editable-field').forEach(function(field) {
                field.classList.remove('error', 'success');
            });

            // Hide auto-save indicator
            hideAutoSaveIndicator();
            if (autoSaveTimer) clearTimeout(autoSaveTimer);

            currentPatient = null;
        }, 300);
    } else {
        currentPatient = null;
    }
}

// ============================================
// Save and Update Functions - ENHANCED
// ============================================
async function savePatientDetails() {
    if (!currentPatient) return;

    // Show loading overlay during save
    const saveOverlay = document.getElementById('saveOverlay');
    if (saveOverlay) saveOverlay.classList.add('show');

    const wasRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(currentPatient) : false;

    // Get all form elements
    const elements = {
        modalName: document.getElementById('modalName'),
        modalSchoolId: document.getElementById('modalSchoolId'),
        modalAge: document.getElementById('modalAge'),
        modalGender: document.getElementById('modalGender'),
        modalGrade: document.getElementById('modalGrade'),
        modalContact: document.getElementById('modalContact'),
        modalGuardian: document.getElementById('modalGuardian'),
        modalAddress: document.getElementById('modalAddress'),
        modalBirthdate: document.getElementById('modalBirthdate'),
        modalBP: document.getElementById('modalBP'),
        modalComplaint: document.getElementById('modalComplaint'),
        modalNotes: document.getElementById('modalNotes'),
        modalManagement: document.getElementById('modalManagement')
    };

    // Validate required fields
    const name = elements.modalName ? elements.modalName.value.trim() : '';
    if (!name) {
        showToast('Patient name is required', 'critical');
        if (elements.modalName) {
            elements.modalName.classList.add('error');
            elements.modalName.focus();
        }
        if (saveOverlay) saveOverlay.classList.remove('show');
        return;
    }

    // Validate name format (Surname, First Name, Middle Name)
    const nameParts = name.split(',').map(function(p) { return p.trim(); });
    if (nameParts.length < 2) {
        showToast('Please use format: SURNAME, FIRST NAME, MIDDLE NAME', 'warning');
        if (elements.modalName) elements.modalName.classList.add('error');
        if (saveOverlay) saveOverlay.classList.remove('show');
        return;
    }

    // Validate age if provided
    const age = elements.modalAge ? elements.modalAge.value : '';
    if (age) {
        const ageNum = parseInt(age);
        if (isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
            showToast('Please enter a valid age (1-120)', 'warning');
            if (elements.modalAge) elements.modalAge.classList.add('error');
            if (saveOverlay) saveOverlay.classList.remove('show');
            return;
        }
    }

    // Validate blood pressure format if provided
    const bloodPressure = elements.modalBP ? elements.modalBP.value.trim() : '';
    if (bloodPressure && !/^\d{2,3}\/\d{2,3}$/.test(bloodPressure)) {
        showToast('Please use BP format: 120/80', 'warning');
        if (elements.modalBP) elements.modalBP.classList.add('error');
        if (saveOverlay) saveOverlay.classList.remove('show');
        return;
    }

    // Extract new field values
    const guardian = elements.modalGuardian ? elements.modalGuardian.value.trim() : '';
    const address = elements.modalAddress ? elements.modalAddress.value.trim() : '';
    const birthdate = elements.modalBirthdate ? elements.modalBirthdate.value : '';
    const management = elements.modalManagement ? elements.modalManagement.value.trim() : '';

    // Update patient object - ensure name is always stored uppercase
    currentPatient.name = name.toUpperCase();
    currentPatient.schoolId = elements.modalSchoolId ? elements.modalSchoolId.value.trim() : '';
    currentPatient.age = age ? parseInt(age) : '';
    currentPatient.gender = elements.modalGender ? elements.modalGender.value : '';
    currentPatient.grade = elements.modalGrade ? elements.modalGrade.value.trim() : '';
    currentPatient.contact = elements.modalContact ? elements.modalContact.value.trim() : '';
    currentPatient.guardian = guardian;
    currentPatient.address = address;
    currentPatient.birthdate = birthdate;
    currentPatient.vitals.bloodPressure = bloodPressure;
    currentPatient.complaint = elements.modalComplaint ? elements.modalComplaint.value.trim() : '';
    currentPatient.notes = elements.modalNotes ? elements.modalNotes.value.trim() : '';
    currentPatient.management = management;

    // Recalculate status based on updated vitals
    updatePatientStatus(currentPatient);

    // Save to database via shared-data.js function
    const saved = await savePatientToDB(currentPatient);
    if (!saved) {
        showToast('Failed to save to database', 'critical');
        if (saveOverlay) saveOverlay.classList.remove('show');
        return;
    }

    // Force refresh from database to ensure UI shows saved data
    await loadPatientsFromDB();

    // Update filteredData to reflect changes
    const updatedIndex = patientsData.findIndex(p => p.id === currentPatient.id);
    if (updatedIndex !== -1) {
        const updatedPatient = patientsData[updatedIndex];
        const filteredIndex = filteredData.findIndex(p => p.id === currentPatient.id);
        if (filteredIndex !== -1) {
            filteredData[filteredIndex] = updatedPatient;
        }
    }

    // Hide loading overlay
    if (saveOverlay) saveOverlay.classList.remove('show');

    // Check registration status change
    const isNowRegistered = hasPatientBeenRegistered ? hasPatientBeenRegistered(currentPatient) : false;

    if (!wasRegistered && isNowRegistered) {
        showToast('✓ Patient fully registered! Queue progress updated.');
    } else {
        const statusMsg = currentPatient.status === 'unstable' 
            ? '✓ Saved! Status: UNSTABLE - ' + currentPatient.stabilityReason
            : '✓ Patient details saved successfully';
        showToast(statusMsg);
    }

    // Refresh UI
    renderTable();
    updateStats();
    updateRegistrationProgress();
    closeModal();
}

// ============================================
// TEMPLATE PICKER FUNCTIONS
// ============================================

function openTemplatePicker() {
    if (!currentPatient) {
        showToast('No patient selected', 'critical');
        return;
    }

    const pickerModal = document.getElementById('templatePickerModal');
    if (pickerModal) {
        pickerModal.style.display = 'flex';
        pickerModal.classList.add('show');
    }
}

function closeTemplatePicker() {
    const pickerModal = document.getElementById('templatePickerModal');
    if (pickerModal) {
        pickerModal.classList.remove('show');
        setTimeout(function() {
            pickerModal.style.display = 'none';
        }, 300);
    }
    selectedTemplateType = null;
}

function selectTemplate(templateType) {
    selectedTemplateType = templateType;
    closeTemplatePicker();

    // Small delay to let picker close animation finish
    setTimeout(function() {
        openDocumentWindow(currentPatient, templateType);
    }, 350);
}

function openDocumentWindow(patient, templateType) {
    if (!patient) {
        showToast('No patient selected', 'critical');
        return;
    }

    // Validate minimum required fields
    if (!patient.name || !patient.name.trim()) {
        showToast('Please enter patient name before printing', 'warning');
        return;
    }

    // Parse individual vitals for forms
    const bp = patient.vitals?.bloodPressure || '';
    const rr = ''; // Respiratory rate - not collected in current system
    const pr = patient.vitals?.heartRate || ''; // Pulse rate = heart rate
    const temp = patient.vitals?.temperature || '';
    const spo2 = patient.vitals?.oxygenSat || '';

    // Prepare data for the document
    const docData = {
        templateType: templateType,
        name: patient.name,
        schoolId: patient.schoolId || '',
        age: patient.age || '',
        gender: patient.gender || '',
        grade: patient.grade || '',
        guardian: patient.guardian || '',
        address: patient.address || '',
        birthdate: patient.birthdate || '',
        date: formatDateFull(patient.date),
        time: patient.time || '',
        hashtag: typeof window.formatHashtag === 'function' 
            ? window.formatHashtag(patient.hashtag) 
            : formatHashtagDisplay(patient.hashtag),
        complaint: patient.complaint || '',
        bp: bp,
        rr: rr,
        pr: pr,
        temp: temp,
        spo2: spo2,
        management: patient.management || '',
        notes: patient.notes || '',
        nurseName: localStorage.getItem('nurseName') || '',
        licenseNo: localStorage.getItem('licenseNo') || ''
    };

    // Save to localStorage as fallback
    localStorage.setItem('documentData', JSON.stringify(docData));

    // Build URL with parameters
    const params = new URLSearchParams();
    Object.entries(docData).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
    });

    // Open document in new window
    const url = 'excuse-letter.html?' + params.toString();
    const popup = window.open(url, 'clinicDocument', 'width=900,height=1200,scrollbars=yes,resizable=yes');

    // Fallback if popup is blocked
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        window.location.href = url;
    }
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
        showToast('✓ Table refreshed with latest data');
    } else {
        showToast('Failed to refresh data', 'critical');
    }

    showLoading(false);
    if (btn) btn.classList.remove('refreshing');
}

function exportData() {
    const dateFromEl = document.getElementById('dateFrom');
    const dateToEl = document.getElementById('dateTo');
    const searchHashtagEl = document.getElementById('searchHashtag');
    const searchNameEl = document.getElementById('searchName');

    const dateFrom = dateFromEl ? dateFromEl.value : '';
    const dateTo = dateToEl ? dateToEl.value : '';
    const hashtagFilter = searchHashtagEl ? searchHashtagEl.value.trim() : '';
    const nameFilter = searchNameEl ? searchNameEl.value.trim().toLowerCase() : '';

    let dataToExport = [];

    if (dateFrom || dateTo || hashtagFilter || nameFilter) {
        dataToExport = [...filteredData];
    } else {
        dataToExport = [...patientsData];
    }

    dataToExport.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

    if (dataToExport.length === 0) {
        showToast('No data to export. Please check your filters.', 'warning');
        return;
    }

    const excelData = dataToExport.map(function(p) {
        return {
            'Hashtag #': typeof window.formatHashtag === 'function' 
                ? window.formatHashtag(p.hashtag) 
                : formatHashtagDisplay(p.hashtag),
            'Date': formatDateForExcel(p.date),
            'Time': p.time || '-',
            'Patient Name': p.name && p.name.trim() ? p.name : 'NOT REGISTERED',
            'School ID': p.schoolId || '-',
            'Age': p.age || '-',
            'Gender': p.gender || '-',
            'Course/Year/Section': p.grade || '-',
            'Contact': p.contact || '-',
            'Guardian': p.guardian || '-',
            'Address': p.address || '-',
            'Birthdate': p.birthdate || '-',
            'Status': p.status ? p.status.toUpperCase() : 'UNKNOWN',
            'Stability Reason': p.stabilityReason || '-',
            'Temperature (°C)': p.vitals.temperature || '-',
            'Heart Rate (bpm)': p.vitals.heartRate || '-',
            'Blood Pressure': p.vitals.bloodPressure || '-',
            'Oxygen Saturation (%)': p.vitals.oxygenSat || '-',
            'Symptoms/Complaint': p.complaint || '-',
            'Nurse Notes': p.notes || '-',
            'Management': p.management || '-',
            'Registration Status': (hasPatientBeenRegistered && hasPatientBeenRegistered(p)) ? 'REGISTERED' : 'PENDING'
        };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    const colWidths = [
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 25 }, { wch: 15 },
        { wch: 8 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 25 },
        { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 40 },
        { wch: 15 }
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
        showToast(`✓ Exported ${dataToExport.length} records to ${filename}`);
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
    const today = getTodayDate ? getTodayDate() : new Date().toISOString().split('T')[0];

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
        modal.classList.add('show');
    }
}

function hideSignOutModal() { 
    const modal = document.getElementById('signOutModal');
    if (modal) {
        modal.classList.remove('show');
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

    if (!toast || !toastMessage) return;

    const toastIcon = toast.querySelector('i');

    toastMessage.textContent = message;
    toast.className = 'toast';

    switch(type) {
        case 'warning':
            toast.classList.add('warning');
            if (toastIcon) toastIcon.className = 'fas fa-exclamation-triangle';
            break;
        case 'critical':
            if (toastIcon) toastIcon.className = 'fas fa-exclamation-circle';
            break;
        default:
            if (toastIcon) toastIcon.className = 'fas fa-check-circle';
    }

    toast.classList.add('show');

    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() {
            if (toastIcon) toastIcon.className = 'fas fa-check-circle';
        }, 300);
    }, 3000);
}

// ============================================
// GLOBAL EXPORTS
// ============================================
window.openPatientModal = openPatientModal;
window.closeModal = closeModal;
window.savePatientDetails = savePatientDetails;
window.openExcuseLetter = openDocumentWindow; // Backward compatibility
window.openTemplatePicker = openTemplatePicker;
window.closeTemplatePicker = closeTemplatePicker;
window.selectTemplate = selectTemplate;
window.openDocumentWindow = openDocumentWindow;
window.refreshTable = refreshTable;
window.exportData = exportData;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.filterPendingOnly = filterPendingOnly;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.updatePatientStatus = updatePatientStatus;