.PHONY: tauri-ios-build

NEXT_PUBLIC_BASE_URL := https://template.geebosblog.com

tauri-ios-build:
	NEXT_PUBLIC_BASE_URL=$(NEXT_PUBLIC_BASE_URL) pnpm tauri ios build
