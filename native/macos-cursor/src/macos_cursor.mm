#import <napi.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CommonCrypto/CommonDigest.h>
#include <unordered_map>
#include <string>
#include <mutex>

// ---------------------------------------------------------------------------
// Cursor identification via image hashing + dynamic learning
//
// On macOS 15+, [NSCursor arrowCursor] and [NSCursor IBeamCursor] return
// cursors with EMPTY images (0 representations).  `isEqual:` also fails
// because `currentSystemCursor` returns display-scaled instances.
//
// Strategy:
//   1. Pre-seed hash map with class-method cursors that DO have images
//      (pointingHand, openHand, closedHand, crosshair, resize*, etc.)
//   2. The first unknown cursor is labelled "arrow" (the system always
//      starts with the arrow cursor before any app changes it).
//   3. Subsequent unknowns are classified by comparing their image
//      dimensions against the learned arrow dimensions.
//   4. Every identification is cached by hash → O(1) future lookups.
// ---------------------------------------------------------------------------

static std::unordered_map<std::string, std::string> g_hashToName;
static std::mutex g_mutex;
static bool g_initialized = false;
static bool g_arrowLearned = false;
static double g_arrowArea = 0;          // width*height of the learned arrow cursor

// Hash the smallest bitmap rep as PNG.
static std::string hashCursorImage(NSCursor* cursor) {
  if (!cursor) return "";
  NSImage* img = [cursor image];
  if (!img) return "";

  NSArray<NSImageRep*>* reps = [img representations];
  if ([reps count] == 0) return "";

  NSBitmapImageRep* smallest = nil;
  for (NSImageRep* rep in reps) {
    if ([rep isKindOfClass:[NSBitmapImageRep class]]) {
      if (!smallest || [rep pixelsWide] < [smallest pixelsWide])
        smallest = (NSBitmapImageRep*)rep;
    }
  }
  if (!smallest) return "";

  NSData* png = [smallest representationUsingType:NSBitmapImageFileTypePNG
                                       properties:@{}];
  if (!png || [png length] == 0) return "";

  unsigned char digest[CC_MD5_DIGEST_LENGTH];
  CC_MD5([png bytes], (CC_LONG)[png length], digest);
  char hex[CC_MD5_DIGEST_LENGTH * 2 + 1];
  for (int i = 0; i < CC_MD5_DIGEST_LENGTH; i++)
    snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return std::string(hex, CC_MD5_DIGEST_LENGTH * 2);
}

// Classify an unknown cursor that wasn't matched by hash.
// Uses image dimensions relative to the learned arrow cursor.
static std::string classifyUnknown(NSCursor* cursor) {
  if (!cursor) return "arrow";

  NSSize sz = [[cursor image] size];
  if (sz.width < 1 || sz.height < 1) return "arrow";

  double area = sz.width * sz.height;
  double aspect = sz.width / sz.height;

  // If arrow not yet learned, this IS the arrow (first-seen rule)
  if (!g_arrowLearned) {
    g_arrowLearned = true;
    g_arrowArea = area;
    return "arrow";
  }

  // IBeam: notably SMALLER area than arrow, OR very narrow aspect (< 0.5)
  // macOS IBeam is a thin vertical line, much less pixel area than arrow
  if (aspect < 0.5) return "ibeam";
  if (area < g_arrowArea * 0.4) return "ibeam";

  // NotAllowed: larger than arrow (has the circle-slash graphic)
  if (area > g_arrowArea * 1.5) return "notAllowed";

  // Default to arrow for similar-sized cursors
  return "arrow";
}

// Seed the hash map with class-method cursors that have valid images.
static void initKnownCursors() {
  @autoreleasepool {
    struct { NSCursor* cursor; const char* name; } known[] = {
      { [NSCursor pointingHandCursor],             "pointingHand" },
      { [NSCursor openHandCursor],                 "openHand" },
      { [NSCursor closedHandCursor],               "closedHand" },
      { [NSCursor crosshairCursor],                "crosshair" },
      { [NSCursor resizeLeftRightCursor],           "resizeLeftRight" },
      { [NSCursor resizeUpDownCursor],              "resizeUpDown" },
      { [NSCursor operationNotAllowedCursor],       "notAllowed" },
      { [NSCursor dragCopyCursor],                  "dragCopy" },
      { [NSCursor dragLinkCursor],                  "dragLink" },
      { [NSCursor contextualMenuCursor],            "contextualMenu" },
      { [NSCursor IBeamCursorForVerticalLayout],    "ibeamVertical" },
    };

    for (auto& entry : known) {
      std::string h = hashCursorImage(entry.cursor);
      if (!h.empty()) {
        g_hashToName[h] = entry.name;
      }
    }
    g_initialized = true;
  }
}

// Look up or learn the name for a cursor.
static std::string identifyCursor(NSCursor* current) {
  std::string h = hashCursorImage(current);

  // Known hash → immediate return
  if (!h.empty()) {
    auto it = g_hashToName.find(h);
    if (it != g_hashToName.end()) {
      return it->second;
    }
  }

  // Unknown hash → classify and cache
  std::string name = classifyUnknown(current);
  if (!h.empty()) {
    g_hashToName[h] = name;
  }
  return name;
}

// ── Exported N-API functions ───────────────────────────────────────────

Napi::String GetCurrentCursorType(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  @autoreleasepool {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_initialized) initKnownCursors();

    NSCursor* current = [NSCursor currentSystemCursor];
    if (!current) return Napi::String::New(env, "arrow");

    std::string name = identifyCursor(current);
    return Napi::String::New(env, name);
  }
}

Napi::String DebugCursorInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  @autoreleasepool {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_initialized) initKnownCursors();

    NSCursor* current = [NSCursor currentSystemCursor];
    if (!current) return Napi::String::New(env, "{\"nil\":true}");

    NSPoint hs = [current hotSpot];
    NSSize sz = [[current image] size];
    std::string h = hashCursorImage(current);
    std::string name = identifyCursor(current);

    char buf[1024];
    snprintf(buf, sizeof(buf),
      "{\"hotspot\":[%.1f,%.1f],\"size\":[%.0f,%.0f],\"hash\":\"%s\","
      "\"name\":\"%s\",\"mapSize\":%lu,\"arrowLearned\":%s,\"arrowArea\":%.0f}",
      hs.x, hs.y, sz.width, sz.height, h.c_str(),
      name.c_str(), (unsigned long)g_hashToName.size(),
      g_arrowLearned ? "true" : "false", g_arrowArea);
    return Napi::String::New(env, buf);
  }
}

Napi::Boolean SetSystemCursorHidden(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  bool hidden = info[0].As<Napi::Boolean>().Value();

  if (hidden) {
    CGDisplayHideCursor(CGMainDisplayID());
  } else {
    CGDisplayShowCursor(CGMainDisplayID());
  }

  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getCurrentCursorType", Napi::Function::New(env, GetCurrentCursorType));
  exports.Set("setSystemCursorHidden", Napi::Function::New(env, SetSystemCursorHidden));
  exports.Set("debugCursorInfo", Napi::Function::New(env, DebugCursorInfo));
  return exports;
}

NODE_API_MODULE(macos_cursor, Init)
