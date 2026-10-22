import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The reply target is chosen inside the n8n Code node, so the workflow JSON is
// the only source of truth: run its jsCode with the globals n8n provides.
interface WorkflowNode {
  name: string
  parameters: { jsCode?: string }
}

const workflow = JSON.parse(
  readFileSync(new URL('../documentation/n8n/send-docket-email.workflow.json', import.meta.url), 'utf8'),
) as { nodes: WorkflowNode[] }

const jsCode = workflow.nodes.find((n) => n.name === 'Pick Last Message')?.parameters.jsCode ?? ''

function pick(
  messages: Array<Record<string, unknown>>,
  body: Record<string, unknown>,
): string | undefined {
  const $input = { all: () => messages.map((json) => ({ json })) }
  const $ = (name: string) => {
    assert.equal(name, 'Webhook')
    return { first: () => ({ json: { body }, binary: { attachment: {} } }) }
  }
  const [item] = new Function('$input', '$', jsCode)($input, $)
  return item.json.messageId
}

// Thread 1a1341187b6a9ea1 (execution 7218): RFQ from the party, our internal
// forward, then an internal colleague's reply last. Picking the newest message
// mailed the colleague and dropped the party entirely.
const THREAD = [
  { id: 'party-1', internalDate: '1791874880000', From: 'Essqube Enterprise <essqube@gmail.com>' },
  { id: 'self', internalDate: '1791879767000', From: 'Puja Agarwal <puja.agarwal@laserpowerinfra.com>' },
  { id: 'colleague', internalDate: '1792055055000', From: 'Tanmoy Das <laserentry.four@gmail.com>' },
]

test('replies to the party, not to whoever wrote last in the thread', () => {
  assert.equal(pick(THREAD, { to: 'essqube@gmail.com' }), 'party-1')
})

test('the newest message from the party wins', () => {
  const thread = [...THREAD, { id: 'party-2', internalDate: '1792059999999', From: 'Billing <billing@essqube.com>' }]
  assert.equal(pick(thread, { to: 'essqube@gmail.com, billing@essqube.com' }), 'party-2')
})

test('falls back to the thread first message when the party has none', () => {
  assert.equal(pick(THREAD, { to: 'someone@else.com' }), 'party-1')
})

test('matches whatever the case, display name or message order', () => {
  assert.equal(pick([...THREAD].reverse(), { to: 'ESSQUBE@GMAIL.COM' }), 'party-1')
})
