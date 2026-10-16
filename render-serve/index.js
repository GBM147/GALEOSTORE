#!/usr/bin/env node
import { startServer, closeRuntime } from '../server/index.js'

startServer().catch(async error => {
  console.error('Não foi possível iniciar a API:', error.code || 'STARTUP_ERROR')
  await closeRuntime().catch(() => {})
  process.exitCode = 1
})
