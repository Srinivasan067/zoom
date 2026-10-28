'use client'

import { createContext, useContext, type ReactNode } from 'react'

const DisplayNameContext = createContext('')

export function MeetingDisplayName({ name, children }: { name: string; children: ReactNode }) {
  return <DisplayNameContext.Provider value={name}>{children}</DisplayNameContext.Provider>
}

export function useMeetingDisplayName() {
  return useContext(DisplayNameContext)
}
