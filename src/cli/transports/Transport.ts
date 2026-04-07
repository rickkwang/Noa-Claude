// @ts-nocheck
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

export type Transport = {
  connect(): Promise<void>
  close(): void
  write(message: StdoutMessage): Promise<void>
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  getStateLabel?(): string
  setOnConnect?(callback: () => void): void
}
