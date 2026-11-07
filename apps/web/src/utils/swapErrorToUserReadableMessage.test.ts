import { didUserReject } from 'utils/swapErrorToUserReadableMessage'

describe('didUserReject', () => {
  it('detects a rejection by code or message', () => {
    expect(didUserReject({ code: 4001 })).toBe(true)
    expect(didUserReject(new Error('User rejected the request.'))).toBe(true)
  })

  it('ignores a non-string reason instead of throwing', () => {
    const error = Object.assign(new Error('order registration failed'), { reason: { code: 'tx_sender_mismatch' } })
    expect(didUserReject(error)).toBe(false)
  })

  it('falls back to the message when the reason is not text', () => {
    const error = Object.assign(new Error('User rejected the request.'), { reason: { code: 4001 } })
    expect(didUserReject(error)).toBe(true)
  })
})
