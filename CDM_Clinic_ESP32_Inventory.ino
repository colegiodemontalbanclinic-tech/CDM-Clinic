/*
  ==========================================
  ESP32 TO LCD PINOUT GUIDE
  ==========================================

  LCD VCC      -> ESP32 3.3V
  LCD GND      -> ESP32 GND
  LCD CS       -> ESP32 GPIO 5   (TFT_CS)
  LCD RESET    -> ESP32 GPIO 17  (TFT_RST)
  LCD DC/RS    -> ESP32 GPIO 16  (TFT_DC)
  LCD SDI/MOSI -> ESP32 GPIO 23  (TFT_MOSI)
  LCD SCK/CLK  -> ESP32 GPIO 18  (TFT_SCLK)
  LCD SDO/MISO -> ESP32 GPIO 19  (TFT_MISO)
  LCD LED      -> ESP32 GPIO 21  (TFT_LED)

  LCD T_CLK    -> ESP32 GPIO 18  (SHARED with SCK!)
  LCD T_CS     -> ESP32 GPIO 33  (TOUCH_CS)
  LCD T_DIN    -> ESP32 GPIO 23  (SHARED with MOSI!)
  LCD T_DO     -> ESP32 GPIO 19  (SHARED with MISO!)
  LCD T_IRQ    -> ESP32 GPIO 36  (TOUCH_IRQ)

  ==========================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <time.h>

// ==================== CONFIG ====================
const char* WIFI_SSID     = "-//-";
const char* WIFI_PASSWORD = "0123456789";
const char* SUPABASE_URL  = "https://cbenviudczmhrthvqntc.supabase.co";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiZW52aXVkY3ptaHJ0aHZxbnRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjAyMDcsImV4cCI6MjA5MTAzNjIwN30.oxBJwGZmta9B-qZi4_zmr_71-ktx-fafS_JidP9IWu0";

const char* TABLE_NAME = "large_inventory";
#define TFT_LED 21

// Colors
#define BG_D    0x0A20
#define PANEL   0x1A40
#define G_BASE  0x0400
#define G_LIME  0x07E0
#define TXT_W   0xFFFF
#define TXT_G   0xC618
#define RED     0xD8A0
#define YEL     0xFE40
#define ORANGE  0xFC00

// ==================== DATA ====================
struct Item {
  int id;
  char barcode[32];
  char boxName[24];
  int quantity;
  char expDate[12];
  int daysLeft;
};

Item items[40];
int totalItems = 0;
int currentPage = 0;
const int ITEMS_PER_PAGE = 3;

TFT_eSPI tft = TFT_eSPI();
unsigned long lastRefresh = 0;
const unsigned long REFRESH_MS = 30000;

char scanBuf[32] = "";
bool wifiOK = false;

// Touch variables
uint16_t tx = 0, ty = 0;
unsigned long lastTouch = 0;

// Error message buffers
char errMsg[48] = "";
char errDetail[64] = "";

// New item display buffer
char newItemName[24] = "";
char newItemExpiry[12] = "";
int newItemQty = 0;
char newItemDate[20] = "";

// State tracking
bool showingAddOK = false;
unsigned long addOKStartTime = 0;
const unsigned long ADD_OK_DURATION = 7000;

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(500);
  
  pinMode(TFT_LED, OUTPUT);
  digitalWrite(TFT_LED, HIGH);
  
  tft.init();
  // Touch threshold: lower = more sensitive, higher = less noise
  // tft.setTouchCalibration(300, 3400, 300, 3400); // Uncomment & adjust if needed
  tft.setRotation(3);
  tft.fillScreen(BG_D);
  
  tft.setTextColor(YEL);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("CDM CLINIC INVENTORY", 160, 100, 2);
  tft.setTextColor(TXT_G);
  tft.drawString("Connecting...", 160, 130, 2);
  
  if (!connectWiFi()) {
    error("WiFi Failed", "Check credentials");
    return;
  }
  
  // Sync NTP time after WiFi connects
  tft.setTextColor(YEL);
  tft.drawString("Syncing time...", 160, 150, 2);
  syncNTPTime();
  
  tft.setTextColor(YEL);
  tft.drawString("Loading...", 160, 170, 2);
  fetchData();
  
  drawList();
}

// ==================== NTP TIME SYNC ====================
void syncNTPTime() {
  // Set timezone to Philippines (UTC+8)
  configTime(28800, 0, "pool.ntp.org", "time.nist.gov");
  
  Serial.print("Syncing NTP time");
  int retries = 0;
  while (time(nullptr) < 1000000000 && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();
  
  time_t now = time(nullptr);
  struct tm* ti = localtime(&now);
  Serial.printf("Current date: %04d-%02d-%02d\n", 
    ti->tm_year + 1900, ti->tm_mon + 1, ti->tm_mday);
}

// ==================== GET CURRENT DATE ====================
void getCurrentDate(int &year, int &month, int &day) {
  time_t now = time(nullptr);
  struct tm* ti = localtime(&now);
  year = ti->tm_year + 1900;
  month = ti->tm_mon + 1;
  day = ti->tm_mday;
}

// ==================== CALCULATE DAYS LEFT ====================
int calcDaysLeft(const char* expDateStr) {
  if (!expDateStr || strlen(expDateStr) < 10) return -999;
  
  int expY, expM, expD;
  if (sscanf(expDateStr, "%d-%d-%d", &expY, &expM, &expD) != 3) return -999;
  
  int curY, curM, curD;
  getCurrentDate(curY, curM, curD);
  
  // Calculate days difference using Julian day number
  long jdnExp = (1461L * (expY + 4800L + (expM - 14) / 12)) / 4 
              + (367L * (expM - 2 - 12 * ((expM - 14) / 12))) / 12 
              - (3L * ((expY + 4900L + (expM - 14) / 12) / 100)) / 4 
              + expD - 32075;
              
  long jdnCur = (1461L * (curY + 4800L + (curM - 14) / 12)) / 4 
              + (367L * (curM - 2 - 12 * ((curM - 14) / 12))) / 12 
              - (3L * ((curY + 4900L + (curM - 14) / 12) / 100)) / 4 
              + curD - 32075;
  
  return (int)(jdnExp - jdnCur);
}

// ==================== GET EXPIRY COLOR ====================
uint16_t getExpiryColor(int daysLeft) {
  if (daysLeft == -999) return RED;
  if (daysLeft <= 0) return RED;
  if (daysLeft <= 7) return ORANGE;
  return G_LIME;
}

// ==================== LOOP ====================
void loop() {
  handleSerial();
  
  if (tft.getTouch(&tx, &ty)) {
    if (millis() - lastTouch > 50) {
      lastTouch = millis();
      handleTouch();
    }
  }
  
  if (showingAddOK && (millis() - addOKStartTime > ADD_OK_DURATION)) {
    showingAddOK = false;
    fetchData();
    drawList();
  }
  
  if (wifiOK && !showingAddOK) {
    if (millis() - lastRefresh > REFRESH_MS) {
      fetchData();
      if (!showingAddOK) drawList();
    }
  }
  
  delay(1);
}

// ==================== FETCH DATA ====================
void fetchData() {
  wifiOK = false;
  
  if (WiFi.status() != WL_CONNECTED) {
    error("WiFi Lost", "Reconnecting...");
    return;
  }
  
  HTTPClient http;
  http.setTimeout(10000);
  
  char url[200];
  snprintf(url, sizeof(url), "%s/rest/v1/%s?select=id,barcode,box_name,quantity,expiration_date&order=id.asc",
           SUPABASE_URL, TABLE_NAME);
  
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Accept", "application/json");
  
  int code = http.GET();
  
  if (code != 200) {
    char detail[32];
    snprintf(detail, sizeof(detail), "Code: %d", code);
    error("HTTP Error", detail);
    http.end();
    return;
  }
  
  String resp = http.getString();
  http.end();
  
  DynamicJsonDocument doc(8192);
  DeserializationError err = deserializeJson(doc, resp);
  
  if (err) {
    error("JSON Error", err.c_str());
    return;
  }
  
  JsonArray arr = doc.as<JsonArray>();
  totalItems = 0;
  
  for (JsonObject v : arr) {
    if (totalItems >= 40) break;
    strlcpy(items[totalItems].barcode, v["barcode"] | "N/A", 32);
    strlcpy(items[totalItems].boxName, v["box_name"] | "Unknown", 24);
    items[totalItems].quantity = v["quantity"] | 0;
    items[totalItems].id = v["id"] | 0;
    
    const char* ed = v["expiration_date"];
    if (ed) {
      strlcpy(items[totalItems].expDate, ed, 12);
      items[totalItems].daysLeft = calcDaysLeft(ed);
    } else {
      strcpy(items[totalItems].expDate, "N/A");
      items[totalItems].daysLeft = -999;
    }
    
    totalItems++;
  }
  
  wifiOK = true;
  lastRefresh = millis();
  
  // SERIAL OUTPUT with current date
  int cy, cm, cd;
  getCurrentDate(cy, cm, cd);
  
  Serial.println("\n========== INVENTORY DATABASE ==========");
  Serial.printf("Current Date: %04d-%02d-%02d\n", cy, cm, cd);
  Serial.printf("Total Items: %d\n", totalItems);
  Serial.println("----------------------------------------");
  Serial.println("ID  | BOX NAME         | QTY | DAYS LEFT");
  Serial.println("----------------------------------------");
  
  for (int i = 0; i < totalItems; i++) {
    if (items[i].daysLeft == -999)
      Serial.printf("%-3d | %-16s | %-3d | NO DATE\n",
        items[i].id, items[i].boxName, items[i].quantity);
    else if (items[i].daysLeft <= 0)
      Serial.printf("%-3d | %-16s | %-3d | EXPIRED (%d)\n",
        items[i].id, items[i].boxName, items[i].quantity, items[i].daysLeft);
    else
      Serial.printf("%-3d | %-16s | %-3d | %d days\n",
        items[i].id, items[i].boxName, items[i].quantity, items[i].daysLeft);
  }
  Serial.println("========================================\n");
}

// ==================== ADD ITEM ====================
bool addItem(const char* barcode) {
  if (WiFi.status() != WL_CONNECTED) return false;
  
  HTTPClient http;
  http.setTimeout(10000);
  
  char url[200];
  snprintf(url, sizeof(url), "%s/rest/v1/%s", SUPABASE_URL, TABLE_NAME);
  
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");
  
  StaticJsonDocument<256> doc;
  doc["barcode"] = barcode;
  doc["box_name"] = barcode;
  doc["quantity"] = 1;
  doc["status"] = 1;
  
  String payload;
  serializeJson(doc, payload);
  
  Serial.print("Adding item: ");
  Serial.println(payload);
  
  int code = http.POST(payload);
  http.end();
  
  Serial.printf("POST Response: %d\n", code);
  return (code == 201 || code == 200);
}

// ==================== SERIAL INPUT ====================
void handleSerial() {
  if (!Serial.available()) return;
  
  String s = Serial.readStringUntil('\n');
  s.trim();
  if (s.length() == 0 || s.length() > 31) return;
  
  strcpy(scanBuf, s.c_str());
  Serial.printf("Scanned: %s\n", scanBuf);
  
  if (addItem(scanBuf)) {
    strcpy(newItemName, scanBuf);
    strcpy(newItemExpiry, "N/A");
    newItemQty = 1;
    
    int cy, cm, cd;
    getCurrentDate(cy, cm, cd);
    snprintf(newItemDate, sizeof(newItemDate), "%04d-%02d-%02d", cy, cm, cd);
    
    showingAddOK = true;
    addOKStartTime = millis();
    drawAddOK();
  } else {
    error("Add Failed", "Check connection");
  }
}

// ==================== TOUCH HANDLING ====================
void handleTouch() {
  if (showingAddOK) {
    showingAddOK = false;
    fetchData();
    drawList();
    return;
  }
  
  if (ty > 185) {
    if (tx < 95 && (currentPage + 1) * ITEMS_PER_PAGE < totalItems) { 
      currentPage++;
      drawList(); 
    }
    else if (tx >= 90 && tx <= 230) { 
      currentPage = 0;
      fetchData();
      drawList(); 
    }
    else if (tx > 225 && currentPage > 0) { 
      currentPage--;
      drawList(); 
    }
  }
}

// ==================== RENDERING ====================
void drawHeader() {
  tft.fillRect(0, 0, 320, 26, G_BASE);
  tft.setTextColor(TXT_W);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("CDM CLINIC INVENTORY", 160, 13, 2);
  tft.fillCircle(304, 13, 3, wifiOK ? G_LIME : RED);
}

void drawList() {
  tft.fillScreen(BG_D);
  drawHeader();
  
  int maxPage = (totalItems > 0) ? ((totalItems - 1) / ITEMS_PER_PAGE) : 0;
  if (currentPage > maxPage) currentPage = maxPage;
  
  if (totalItems == 0) {
    tft.setTextColor(YEL);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("No items", 160, 100, 2);
    tft.setTextColor(TXT_G);
    tft.drawString("Scan barcode to add", 160, 130, 2);
  } else {
    for (int i = 0; i < ITEMS_PER_PAGE; i++) {
      int idx = (currentPage * ITEMS_PER_PAGE) + i;
      if (idx >= totalItems) break;
      
      // Safe zone layout: cards end at y=188, safe zone 188-198, buttons at 198
      int y = 32 + (i * 54);  // 50px card + 4px gap
      
      // Card background
      tft.fillRoundRect(8, y, 304, 50, 4, PANEL);
      
      // Box name (top left)
      tft.setTextColor(TXT_W);
      tft.setTextDatum(TL_DATUM);
      tft.drawString(items[idx].boxName, 14, y + 5, 2);
      
      // Quantity (top right)
      int qty = items[idx].quantity;
      uint16_t qtyColor = (qty <= 5) ? RED : (qty <= 15) ? YEL : G_LIME;
      tft.setTextColor(qtyColor);
      tft.setTextDatum(TR_DATUM);
      tft.drawNumber(qty, 306, y + 5, 4);
      tft.setTextColor(TXT_G);
      tft.drawString("qty", 306, y + 24, 1);
      
      // Expiry days left (bottom left)
      char daysStr[20];
      uint16_t expColor = getExpiryColor(items[idx].daysLeft);
      
      if (items[idx].daysLeft == -999) {
        strcpy(daysStr, "NO EXPIRY SET");
      } else if (items[idx].daysLeft == 0) {
        strcpy(daysStr, "EXPIRES TODAY");
      } else if (items[idx].daysLeft < 0) {
        snprintf(daysStr, sizeof(daysStr), "EXPIRED %d DAYS", -items[idx].daysLeft);
      } else {
        snprintf(daysStr, sizeof(daysStr), "%d DAYS LEFT", items[idx].daysLeft);
      }
      
      tft.setTextColor(expColor);
      tft.setTextDatum(TL_DATUM);
      tft.drawString(daysStr, 14, y + 30, 2);
    }
  }
  
  // Page indicator - above safe zone
  tft.setTextColor(TXT_G);
  tft.setTextDatum(MC_DATUM);
  String pg = "Pg " + String(currentPage + 1) + "/" + String(maxPage + 1);
  tft.drawString(pg, 160, 188, 1);
  
  // Nav buttons at y=198 with safe zone below
  drawBtn(2, 192, 90, 30, G_BASE, "<");
  drawBtn(96, 192, 128, 30, G_BASE, "REFRESH");
  drawBtn(228, 192, 90, 30, G_BASE, ">");
}

void drawAddOK() {
  tft.fillScreen(BG_D);
  drawHeader();
  
  tft.fillRoundRect(10, 30, 300, 180, 8, PANEL);
  
  tft.setTextColor(G_LIME);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("NEW MEDICINE ADDED!", 160, 50, 2);
  
  tft.setTextColor(TXT_W);
  tft.drawString("Name:", 60, 80, 2);
  tft.setTextColor(YEL);
  tft.drawString(newItemName, 200, 80, 2);
  
  tft.setTextColor(TXT_W);
  tft.drawString("Expiry:", 60, 105, 2);
  tft.setTextColor(YEL);
  tft.drawString(newItemExpiry, 200, 105, 2);
  
  tft.setTextColor(TXT_W);
  tft.drawString("Qty:", 60, 130, 2);
  tft.setTextColor(YEL);
  tft.drawNumber(newItemQty, 200, 130, 2);
  
  tft.setTextColor(TXT_W);
  tft.drawString("Date:", 60, 155, 2);
  tft.setTextColor(YEL);
  tft.drawString(newItemDate, 200, 155, 2);
  
  tft.setTextColor(TXT_G);
  tft.drawString("Tap to dismiss", 160, 190, 1);
}

void drawError() {
  tft.fillScreen(BG_D);
  drawHeader();
  
  tft.fillRoundRect(20, 40, 280, 100, 8, PANEL);
  tft.setTextColor(RED);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("ERROR", 160, 60, 2);
  tft.setTextColor(TXT_W);
  tft.drawString(errMsg, 160, 82, 2);
  tft.setTextColor(TXT_G);
  tft.drawString(errDetail, 160, 104, 1);
  drawBtn(80, 168, 160, 36, G_BASE, "RETRY");
}

// ==================== HELPERS ====================
void error(const char* msg, const char* detail) {
  strcpy(errMsg, msg);
  strcpy(errDetail, detail);
  drawError();
}

void drawBtn(int x, int y, int w, int h, uint16_t c, const char* txt) {
  tft.fillRoundRect(x, y, w, h, 4, c);
  tft.setTextColor(TXT_W);
  tft.setTextDatum(MC_DATUM);
  tft.drawString(txt, x + (w/2), y + (h/2) + 1, 2);
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    return true;
  }
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  wifiOK = (WiFi.status() == WL_CONNECTED);
  return wifiOK;
}