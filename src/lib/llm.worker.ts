// Runs the local model off the main thread so the page never freezes.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (event: MessageEvent) => handler.onmessage(event)
