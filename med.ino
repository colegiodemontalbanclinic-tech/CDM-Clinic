#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <XPT2046_Touchscreen.h>
#include "HX711.h"
#include <Preferences.h>

// --- Hardware Pins ---
#define TFT_CS      5
#define TFT_DC      2
#define TFT_RST     4
#define TOUCH_CS   21
#define CLUSTER_A_SCK  25
#define CLUSTER_B_SCK  32

const int S_DT[6] = { 16, 17, 26, 27, 14, 33 }; 

Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC, TFT_RST);
XPT2046_Touchscreen touch(TOUCH_CS);
HX711 scales[6];
Preferences prefs;

char MED_NAMES[6][20];
volatile float PILL_WEIGHTS[6];
const float SCALE_FACTORS[6] = { 28000.0, 28000.0, 28000.0, 28000.0, 28000.0, 28000.0 };

const char* DEFAULT_NAMES[6] = { "MED_1", "MED_2", "MED_3", "MED_4", "MED_5", "MED_6" };
const float DEFAULT_WEIGHTS[6] = { 0.50, 0.50, 0.50, 0.50, 0.50, 0.50 };

volatile int currentSensor = 0;
float currentWeight = 0.0;
int currentQty = 0;
bool needsDisplayUpdate = true;

TaskHandle_t TaskUI;
TaskHandle_t TaskWeight;

int lastReportedQty[6] = {-1, -1, -1, -1, -1, -1};
float lastRawWeight[6] = {0, 0, 0, 0, 0, 0};
unsigned long lastQtyChangeTime[6] = {0, 0, 0, 0, 0, 0};
const unsigned long QTY_DEBOUNCE_MS = 500;

// FIX: Semaphore for thread-safe config updates
SemaphoreHandle_t configMutex;

void TaskUIFunction(void * pvParameters);
void TaskWeightFunction(void * pvParameters);
void drawUI();
void updateTFT();
void processSerialCommand(String cmd);
void loadConfigFromNVS();
void saveConfigToNVS();
void sendConfigToDashboard();
void sendQuantityUpdate(int slot, int qty, bool force = false);
int calculateQuantity(float rawWeight, float pillWeight);

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Create mutex for thread safety
  configMutex = xSemaphoreCreateMutex();
  
  if (!prefs.begin("med-config", false)) {
    Serial.println("MSG:NVS init failed, using defaults");
  }
  
  loadConfigFromNVS();
  
  tft.begin(24000000);
  tft.setRotation(1);
  touch.begin();
  touch.setRotation(1);

  tft.fillScreen(ILI9341_BLACK);
  tft.setCursor(50, 100);
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.print("INITIALIZING...");

  for (int i = 0; i < 6; i++) {
    int sck = (i < 3) ? CLUSTER_A_SCK : CLUSTER_B_SCK;
    
    int retries = 0;
    bool scaleReady = false;
    while (retries < 3 && !scaleReady) {
      scales[i].begin(S_DT[i], sck);
      scales[i].set_scale(SCALE_FACTORS[i]);
      
      if (scales[i].wait_ready_timeout(500)) {
        scaleReady = true;
      } else {
        retries++;
        delay(100);
      }
    }
    
    if (!scaleReady) {
      Serial.printf("MSG:WARNING - Scale %d not responding\n", i);
    }
  }

  delay(500);
  sendConfigToDashboard();

  drawUI();

  xTaskCreatePinnedToCore(TaskUIFunction, "TaskUI", 4096, NULL, 1, &TaskUI, 1);
  xTaskCreatePinnedToCore(TaskWeightFunction, "TaskWeight", 4096, NULL, 1, &TaskWeight, 0);
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}

void loadConfigFromNVS() {
  for (int i = 0; i < 6; i++) {
    String nameKey = "name" + String(i);
    String weightKey = "wt" + String(i);
    
    String savedName = prefs.getString(nameKey.c_str(), DEFAULT_NAMES[i]);
    savedName.trim();
    savedName.toUpperCase();
    
    strncpy(MED_NAMES[i], savedName.c_str(), 19);
    MED_NAMES[i][19] = '\0';
    
    PILL_WEIGHTS[i] = prefs.getFloat(weightKey.c_str(), DEFAULT_WEIGHTS[i]);
    
    if (PILL_WEIGHTS[i] <= 0) {
      PILL_WEIGHTS[i] = DEFAULT_WEIGHTS[i];
    }
    
    Serial.printf("Loaded slot %d: %s (%.3fg)\n", i, MED_NAMES[i], PILL_WEIGHTS[i]);
  }
}

void saveConfigToNVS() {
  for (int i = 0; i < 6; i++) {
    String nameKey = "name" + String(i);
    String weightKey = "wt" + String(i);
    
    prefs.putString(nameKey.c_str(), MED_NAMES[i]);
    prefs.putFloat(weightKey.c_str(), PILL_WEIGHTS[i]);
  }
  Serial.println("MSG:Config saved to NVS");
}

void sendConfigToDashboard() {
  Serial.println("REQUEST_CONFIG");
  
  for (int i = 0; i < 6; i++) {
    Serial.printf("CONFIG:%d,%s,%.3f\n", i, MED_NAMES[i], PILL_WEIGHTS[i]);
    delay(50);
  }
  Serial.println("CONFIG_DONE");
}

int calculateQuantity(float rawWeight, float pillWeight) {
  if (rawWeight <= 0.05 || pillWeight <= 0.001) {
    return 0;
  }
  
  float calcQty = rawWeight / pillWeight;
  
  // Use floor for more conservative counting
  return (int)calcQty;
}

void sendQuantityUpdate(int slot, int qty, bool force) {
  unsigned long now = millis();
  
  if (qty == lastReportedQty[slot]) {
    return;
  }
  
  if (!force && (now - lastQtyChangeTime[slot] < QTY_DEBOUNCE_MS)) {
    return;
  }
  
  lastQtyChangeTime[slot] = now;
  lastReportedQty[slot] = qty;
  
  Serial.printf("UPDATE:%s,%d\n", MED_NAMES[slot], qty);
}

// FIX: Global flag to trigger recalculation from command processor
volatile bool triggerRecalc[6] = {false, false, false, false, false, false};

void TaskWeightFunction(void * pvParameters) {
  for (int i = 0; i < 6; i++) {
    lastReportedQty[i] = -1;
    lastRawWeight[i] = 0;
    triggerRecalc[i] = false;
  }

  for (;;) {
    // Process all available serial commands
    while (Serial.available() > 0) {
      String cmd = Serial.readStringUntil('\n');
      cmd.trim();
      if (cmd.length() > 0) {
        processSerialCommand(cmd);
      }
    }

    // FIX: Check if recalculation was triggered by command processor
    for (int i = 0; i < 6; i++) {
      if (triggerRecalc[i]) {
        xSemaphoreTake(configMutex, portMAX_DELAY);
        
        int newQty = calculateQuantity(lastRawWeight[i], PILL_WEIGHTS[i]);
        
        Serial.printf("MSG:RECALC slot %d: raw=%.2fg, pill=%.3fg, new_qty=%d\n", 
                      i, lastRawWeight[i], PILL_WEIGHTS[i], newQty);
        
        // Force send update
        sendQuantityUpdate(i, newQty, true);
        
        if (i == currentSensor) {
          currentQty = newQty;
          needsDisplayUpdate = true;
        }
        
        triggerRecalc[i] = false;
        xSemaphoreGive(configMutex);
      }
    }

    // Scan all 6 sensors
    for (int i = 0; i < 6; i++) {
      float raw = 0;
      bool scaleReady = false;
      
      if (scales[i].wait_ready_timeout(50)) {
        raw = scales[i].get_units(1);
        scaleReady = true;
      }
      
      if (scaleReady) {
        const float ZERO_THRESHOLD = 0.05;
        if (raw < ZERO_THRESHOLD && raw > -ZERO_THRESHOLD) {
          raw = 0;
        }
        
        // Thread-safe update of lastRawWeight
        xSemaphoreTake(configMutex, portMAX_DELAY);
        lastRawWeight[i] = raw;
        xSemaphoreGive(configMutex);
        
        int qty = calculateQuantity(raw, PILL_WEIGHTS[i]);

        if (i == currentSensor) {
          currentWeight = raw;
          currentQty = qty;
        }

        sendQuantityUpdate(i, qty, false);
      }
    }
    
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void processSerialCommand(String cmd) {
  // Process in Weight Task context, so we can set flags for recalculation
  
  if (cmd == "GET_CONFIG") {
    sendConfigToDashboard();
  }
  else if (cmd.startsWith("SET_CONFIG:")) {
    int firstComma = cmd.indexOf(',', 11);
    int secondComma = cmd.indexOf(',', firstComma + 1);
    
    if (firstComma > 0 && secondComma > 0) {
      int slot = cmd.substring(11, firstComma).toInt();
      String name = cmd.substring(firstComma + 1, secondComma);
      float weight = cmd.substring(secondComma + 1).toFloat();
      
      if (slot >= 0 && slot < 6) {
        name.trim();
        name.toUpperCase();
        
        if (name.length() == 0 || name.length() > 19) {
          Serial.printf("MSG:ERROR - Invalid name length for slot %d\n", slot);
          return;
        }
        
        if (weight <= 0 || weight > 10.0) {
          Serial.printf("MSG:ERROR - Invalid weight %.3f for slot %d\n", weight, slot);
          return;
        }
        
        xSemaphoreTake(configMutex, portMAX_DELAY);
        
        float oldPillWeight = PILL_WEIGHTS[slot];
        
        strncpy(MED_NAMES[slot], name.c_str(), 19);
        MED_NAMES[slot][19] = '\0';
        PILL_WEIGHTS[slot] = weight;
        
        saveConfigToNVS();
        
        Serial.printf("MSG:Slot %d updated - %s (%.3fg was %.3fg)\n", 
                      slot, MED_NAMES[slot], weight, oldPillWeight);
        
        // FIX: Trigger recalculation if weight changed significantly
        if (abs(oldPillWeight - weight) > 0.001) {
          triggerRecalc[slot] = true;
          lastReportedQty[slot] = -1; // Force re-report
          Serial.printf("MSG:Triggering recalc for slot %d\n", slot);
        }
        
        if (slot == currentSensor) {
          needsDisplayUpdate = true;
        }
        
        xSemaphoreGive(configMutex);
      } else {
        Serial.printf("MSG:ERROR - Invalid slot %d\n", slot);
      }
    } else {
      Serial.println("MSG:ERROR - Invalid SET_CONFIG format");
    }
  }
  else if (cmd == "CONFIG_SYNC_DONE") {
    Serial.println("MSG:Config sync completed from dashboard");
  }
  else if (cmd == "TARE_ALL") {
    for (int i = 0; i < 6; i++) {
      scales[i].tare();
      lastReportedQty[i] = -1;
      lastRawWeight[i] = 0;
      triggerRecalc[i] = false;
      delay(50);
    }
    needsDisplayUpdate = true;
    Serial.println("MSG:All Sensors Tared");
  }
  else if (cmd.startsWith("TARE:")) {
    int tIdx = cmd.substring(5).toInt();
    if (tIdx >= 0 && tIdx < 6) {
      scales[tIdx].tare();
      lastReportedQty[tIdx] = -1;
      lastRawWeight[tIdx] = 0;
      triggerRecalc[tIdx] = false;
      if (tIdx == currentSensor) {
        needsDisplayUpdate = true;
      }
      Serial.printf("MSG:Sensor %d Tared\n", tIdx);
    } else {
      Serial.printf("MSG:ERROR - Invalid tare index %d\n", tIdx);
    }
  }
  else if (cmd.startsWith("CALIB:")) {
    int commaIndex = cmd.indexOf(',');
    if (commaIndex > 6) {
      int sIdx = cmd.substring(6, commaIndex).toInt();
      float w = cmd.substring(commaIndex + 1).toFloat();
      if (sIdx >= 0 && sIdx < 6 && w > 0) {
        float oldWeight = PILL_WEIGHTS[sIdx];
        PILL_WEIGHTS[sIdx] = w;
        
        if (abs(oldWeight - w) > 0.001) {
          triggerRecalc[sIdx] = true;
          lastReportedQty[sIdx] = -1;
        }
        
        saveConfigToNVS();
        Serial.printf("MSG:Slot %d calibrated to %.3fg\n", sIdx, w);
      }
    }
  }
  else {
    Serial.printf("MSG:WARNING - Unknown command: %s\n", cmd.c_str());
  }
}

void TaskUIFunction(void * pvParameters) {
  int lastDisplayedQty = -1;
  int lastDisplayedSensor = -1;

  for (;;) {
    if (touch.touched()) {
      TS_Point p = touch.getPoint();
      int x = map(p.x, 400, 3600, 320, 0);
      int y = map(p.y, 3600, 400, 0, 240);

      if (y > 170) {
        if (x > 160) { 
          currentSensor = (currentSensor + 1) % 6; 
        } else { 
          currentSensor = (currentSensor - 1 < 0) ? 5 : currentSensor - 1; 
        }
        needsDisplayUpdate = true;
        vTaskDelay(pdMS_TO_TICKS(300));
      }
    }

    if (needsDisplayUpdate || currentQty != lastDisplayedQty || currentSensor != lastDisplayedSensor) {
      updateTFT();
      lastDisplayedQty = currentQty;
      lastDisplayedSensor = currentSensor;
      needsDisplayUpdate = false;
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

void drawUI() {
  tft.fillScreen(ILI9341_BLACK);
  tft.fillRect(0, 0, 320, 40, 0x000F);
  tft.drawFastHLine(0, 40, 320, ILI9341_WHITE);
  tft.setTextColor(ILI9341_WHITE); tft.setTextSize(2);
  tft.setCursor(65, 12); tft.print("CLINIC INVENTORY");
  
  tft.fillRoundRect(10, 185, 135, 45, 8, 0x8000);
  tft.setCursor(55, 200); tft.print("BACK");

  tft.fillRoundRect(175, 185, 135, 45, 8, 0x03E0);
  tft.setCursor(220, 200); tft.print("NEXT");
}
void updateTFT() {
  tft.fillRect(10, 45, 300, 135, ILI9341_BLACK);
  
  tft.setTextColor(ILI9341_CYAN); tft.setTextSize(3);
  tft.setCursor(20, 55); 
  tft.print(MED_NAMES[currentSensor]);

  tft.setTextColor(ILI9341_YELLOW); tft.setTextSize(5);
  tft.setCursor(140, 105); 
  tft.print(currentQty);

  tft.setTextColor(ILI9341_WHITE); tft.setTextSize(2);
  tft.setCursor(130, 150);
  tft.print(currentWeight, 2); tft.print(" g");
}