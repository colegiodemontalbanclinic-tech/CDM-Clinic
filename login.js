// ================= EMAIL CONFIGURATION =================
const ADMIN_EMAIL = "colegiodemontalbanclinic@gmail.com";
const EMAILJS_CONFIG = {
    serviceID: "service_xbum0sr",
    templateID: "template_e5olv7o",
    publicKey: "ZQdfoxYycHpqX68J5"
};

// ================= INITIALIZE EMAILJS =================
emailjs.init(EMAILJS_CONFIG.publicKey);

// ================= CLOCK =================
function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    document.getElementById("clock").textContent = hours + ":" + minutes + " " + ampm;
}
setInterval(updateClock, 1000);
updateClock();

// ================= ERROR NOTIFICATION SYSTEM =================
function showLoginError(message) {
    const existingError = document.getElementById("loginErrorModal");
    if (existingError) existingError.remove();

    const errorModal = document.createElement("div");
    errorModal.id = "loginErrorModal";
    errorModal.className = "error-modal-overlay";
    
    errorModal.innerHTML = `
        <div class="error-modal-content">
            <div class="error-icon">
                <i class="fas fa-exclamation-circle"></i>
            </div>
            <h3 class="error-title">Login Failed</h3>
            <p class="error-message">${message}</p>
            <button class="error-btn" onclick="closeLoginError()">Try Again</button>
        </div>
    `;

    document.body.appendChild(errorModal);
    
    requestAnimationFrame(() => {
        errorModal.classList.add("active");
    });

    errorModal.addEventListener("click", function(e) {
        if (e.target === errorModal) closeLoginError();
    });

    document.addEventListener("keydown", handleErrorEscape);
}

function closeLoginError() {
    const errorModal = document.getElementById("loginErrorModal");
    if (errorModal) {
        errorModal.classList.remove("active");
        setTimeout(() => {
            errorModal.remove();
            document.getElementById("password").value = "";
            document.getElementById("password").focus();
        }, 300);
    }
    document.removeEventListener("keydown", handleErrorEscape);
}

function handleErrorEscape(e) {
    if (e.key === "Escape") closeLoginError();
}

// ================= SUPABASE DATABASE LOGIN =================
document.getElementById("loginForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
        showLoginError("Please fill in all fields.");
        return;
    }

    const btn = document.querySelector("#loginForm button");
    const originalText = btn.textContent;
    btn.textContent = "Verifying...";
    btn.disabled = true;

    document.getElementById("loadingOverlay").style.display = "flex";

    const result = await verifyAdminLogin(username, password);
    
    document.getElementById("loadingOverlay").style.display = "none";
    btn.textContent = originalText;
    btn.disabled = false;

    if (result.success) {
        window.location.href = "dashboard.html";
    } else {
        showLoginError(result.message || "Invalid username or password.");
    }
});

// ================= ENTER KEY =================
document.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
        document.querySelector("#loginForm button").click();
    }
});

// ================= FORGOT PASSWORD MODAL =================
document.querySelector(".forgot-password").addEventListener("click", function(e) {
    e.preventDefault();
    createPasswordResetModal();
});

function createPasswordResetModal() {
    const existingModal = document.getElementById("resetModal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "resetModal";
    modal.className = "modal-overlay";
    
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close" onclick="closeResetModal()">&times;</button>
            
            <h2 class="modal-title">🔐 Reset Password</h2>
            <p class="modal-subtitle">Verification code will be sent to admin email</p>
            
            <!-- Step 1: Admin Email -->
            <div id="step1" class="modal-step active">
                <label class="modal-label">Admin Email</label>
                <input type="email" id="confirmEmail" class="modal-input" value="${ADMIN_EMAIL}" readonly>
                <button class="modal-btn modal-btn-primary" onclick="sendResetEmail()">Send Code</button>
            </div>
            
            <!-- Step 2: Loading -->
            <div id="step2" class="modal-step">
                <div class="modal-loading">
                    <div class="spinner"></div>
                    <p class="modal-loading-text">Sending verification code...</p>
                </div>
            </div>
            
            <!-- Step 3: Enter Verification Code -->
            <div id="step3" class="modal-step">
                <label class="modal-label">Enter Verification Code</label>
                <input type="text" id="verifyCode" class="modal-input" placeholder="Enter 6-digit code" maxlength="6">
                <button class="modal-btn modal-btn-primary" onclick="verifyCode()">Verify Code</button>
                <p style="text-align: center; margin-top: 10px;">
                    <a href="#" onclick="sendResetEmail(); return false;">Resend Code</a>
                </p>
            </div>
            
            <!-- Step 4: Set New Password -->
            <div id="step4" class="modal-step">
                <label class="modal-label">New Password</label>
                <input type="password" id="newPass" class="modal-input" placeholder="Minimum 6 characters">
                
                <label class="modal-label">Confirm New Password</label>
                <input type="password" id="confirmPass" class="modal-input" placeholder="Re-enter new password">
                
                <button class="modal-btn modal-btn-success" onclick="updatePassword()">Update Password</button>
            </div>
            
            <!-- Step 5: Success -->
            <div id="step5" class="modal-step" style="text-align: center;">
                <div class="modal-success-icon">✅</div>
                <h3 class="modal-success-text">Success!</h3>
                <p class="modal-success-subtext">Password updated successfully.</p>
                <button class="modal-btn modal-btn-secondary" onclick="closeResetModal()">Close</button>
            </div>
            
            <!-- Step 6: Error -->
            <div id="step6" class="modal-step" style="text-align: center;">
                <div class="modal-success-icon" style="color: #ff6b6b;">❌</div>
                <h3 class="modal-success-text" style="color: #ff6b6b;">Failed</h3>
                <p class="modal-success-subtext" id="errorDetails" style="color: #ff6b6b; font-size: 0.8rem;"></p>
                <button class="modal-btn modal-btn-secondary" onclick="switchStep(1)">Try Again</button>
            </div>
            
            <p id="errorMsg" class="modal-error"></p>
        </div>
    `;

    document.body.appendChild(modal);
    
    modal.addEventListener("click", function(e) {
        if (e.target === modal) closeResetModal();
    });
    
    document.getElementById("verifyCode")?.addEventListener("keypress", function(e) {
        if (e.key === "Enter") verifyCode();
    });
    document.getElementById("confirmPass")?.addEventListener("keypress", function(e) {
        if (e.key === "Enter") updatePassword();
    });
}

function closeResetModal() {
    const modal = document.getElementById("resetModal");
    if (modal) {
        modal.style.opacity = "0";
        setTimeout(() => modal.remove(), 300);
    }
}

function showError(msg) {
    const errorEl = document.getElementById("errorMsg");
    if (errorEl) {
        errorEl.textContent = msg;
        setTimeout(() => errorEl.textContent = "", 5000);
    }
}

function switchStep(stepNumber) {
    document.querySelectorAll(".modal-step").forEach(step => step.classList.remove("active"));
    document.getElementById("step" + stepNumber).classList.add("active");
}

// Store verification code temporarily
let currentVerificationCode = "";
let codeExpiryTime = null;

// ================= EMAILJS PASSWORD RESET =================
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getExpiryTime() {
    const now = new Date();
    const expiry = new Date(now.getTime() + 10 * 60000);
    return expiry.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });
}

function sendResetEmail() {
    const targetEmail = ADMIN_EMAIL;
    
    if (!targetEmail) {
        showError("❌ Admin email not configured");
        return;
    }
    
    currentVerificationCode = generateVerificationCode();
    codeExpiryTime = new Date(Date.now() + 10 * 60000);
    
    switchStep(2);
    
    const templateParams = {
        to: targetEmail,
        verification_code: currentVerificationCode,
        expiry_minutes: "10",
        expiry_time: getExpiryTime(),
        from_name: "CDM Clinic",
        reply_to: ADMIN_EMAIL
    };
    
    emailjs.send(
        EMAILJS_CONFIG.serviceID,
        EMAILJS_CONFIG.templateID,
        templateParams,
        EMAILJS_CONFIG.publicKey
    ).then((response) => {
        switchStep(3);
        setTimeout(() => document.getElementById("verifyCode")?.focus(), 100);
    }).catch((error) => {
        const errorDetails = document.getElementById("errorDetails");
        if (errorDetails) {
            errorDetails.textContent = error.text || error.message || "Unknown error";
        }
        switchStep(6);
    });
}

function verifyCode() {
    const enteredCode = document.getElementById("verifyCode").value.trim();
    
    if (enteredCode !== currentVerificationCode) {
        showError("❌ Invalid verification code");
        document.getElementById("verifyCode").value = "";
        document.getElementById("verifyCode").focus();
        return;
    }
    
    if (new Date() > codeExpiryTime) {
        showError("❌ Code has expired. Please request a new one.");
        switchStep(1);
        return;
    }
    
    switchStep(4);
    setTimeout(() => document.getElementById("newPass")?.focus(), 100);
}

async function updatePassword() {
    const newPass = document.getElementById("newPass").value.trim();
    const confirmPass = document.getElementById("confirmPass").value.trim();
    
    if (newPass.length < 6) {
        showError("❌ Password must be at least 6 characters");
        return;
    }
    
    if (newPass !== confirmPass) {
        showError("❌ Passwords do not match");
        return;
    }
    
    const success = await updateAdminPassword("admin", newPass);
    
    if (!success) {
        showError("❌ Failed to update password");
        return;
    }
    
    currentVerificationCode = "";
    codeExpiryTime = null;
    
    document.getElementById("password").value = "";
    
    switchStep(5);
}

// ================= LOCATION LINK =================
document.querySelector(".location").addEventListener("click", function() {
    window.open("https://maps.app.goo.gl/8qdGzwv2e7rAUjP77", "_blank");
});