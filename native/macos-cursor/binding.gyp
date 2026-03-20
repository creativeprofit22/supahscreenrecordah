{
  "targets": [{
    "target_name": "macos_cursor",
    "sources": ["src/macos_cursor.mm"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "conditions": [
      ["OS=='mac'", {
        "xcode_settings": {
          "GCC_ENABLE_OBJC_EXCEPTIONS": "YES",
          "CLANG_ENABLE_OBJC_ARC": "YES",
          "OTHER_CPLUSPLUSFLAGS": ["-ObjC++", "-std=c++20"],
          "OTHER_LDFLAGS": ["-framework AppKit", "-framework CoreGraphics"]
        }
      }]
    ]
  }]
}
