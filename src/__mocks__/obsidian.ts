import { vi } from "vitest"

export const requestUrl = vi.fn()
export const Notice = vi.fn()
export const TFile = vi.fn()

// Add other obsidian exports as needed
export default {
    requestUrl,
    Notice,
    TFile
}

// Export types that might be needed
export interface RequestUrlResponse {
    status: number
    text: string
    json: any
}