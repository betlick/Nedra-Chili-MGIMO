import { createContext, useContext } from 'react'
import type { MapEngine } from './gl/engine'

export interface EngineState { engine: MapEngine | null; failed: boolean }
export const EngineCtx = createContext<EngineState>({ engine: null, failed: false })
export const useEngine = () => useContext(EngineCtx)
/** Сам движок (или null, пока он грузится): нужен, чтобы запускать перелёт камеры. */
export const useDive = () => useContext(EngineCtx).engine
