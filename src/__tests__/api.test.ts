import { recordPanDetails, analyzeDocument } from '../services/api'
import type { PanFormData } from '../types'

const mockFetch = jest.fn()
globalThis.fetch = mockFetch as any

const sampleFormData: PanFormData = {
  fullName: 'John Doe',
  gender: 'Male',
  dob: '1990-01-01',
  address: '123 Main St, New Delhi',
  fatherName: 'James Doe',
}

// ---------------------------------------------------------------------------
// recordPanDetails
// ---------------------------------------------------------------------------
describe('recordPanDetails', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns success data when fetch responds with ok=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, record_id: 'rec_123' }),
    })

    const result = await recordPanDetails(sampleFormData)

    expect(result).toEqual({ success: true, record_id: 'rec_123' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/record')
    expect(options.method).toBe('POST')
    expect(options.body).toContain('fullName=John+Doe')
  })

  it('throws with status text when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Bad Request' })

    await expect(recordPanDetails(sampleFormData)).rejects.toThrow(
      'Record creation failed: Bad Request'
    )
  })
})

// ---------------------------------------------------------------------------
// analyzeDocument — response transformation
// ---------------------------------------------------------------------------
describe('analyzeDocument', () => {
  beforeEach(() => jest.clearAllMocks())

  const makeFile = () => new File(['content'], 'doc.pdf', { type: 'application/pdf' })

  it('transforms API extractions into ExtractionResult[] correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extractions: {
          confidence_matrix: {
            name: { consensus_score: '0.95' },
            dob: { consensus_score: '0.80' },
          },
          M1: { name: 'John Doe', dob: '1990-01-01', raw_text: 'raw OCR text' },
          M2: { name: 'John Doe', dob: '1990-01-01' },
          M3: { name: 'John Doe', dob: null },
        },
        annotated_images: { M1: 'base64M1==', M2: 'base64M2==', M3: 'base64M3==' },
      }),
    })

    const result = await analyzeDocument(makeFile(), 'rec_123')

    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({
      attribute: 'name',
      m1: 'John Doe',
      m2: 'John Doe',
      m3: 'John Doe',
      score: '0.95',
    })
    // null API value should be serialised as the string 'null'
    expect(result.results[1]).toMatchObject({ attribute: 'dob', m3: 'null' })
    expect(result.rawText).toBe('raw OCR text')
    expect(result.m1_image).toBe('data:image/png;base64,base64M1==')
    expect(result.m2_image).toBe('data:image/png;base64,base64M2==')
  })

  it('uses the detail string from JSON body as the thrown error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Unprocessable Entity',
      json: async () => ({ detail: 'Invalid record ID provided' }),
    })

    await expect(analyzeDocument(makeFile(), 'bad_id')).rejects.toThrow(
      'Invalid record ID provided'
    )
  })

  it('falls back to statusText when error response is not valid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => { throw new SyntaxError('not json') },
    })

    await expect(analyzeDocument(makeFile(), 'rec_x')).rejects.toThrow(
      'Analysis failed: Internal Server Error'
    )
  })

  it('returns empty image strings when annotated_images is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extractions: {
          confidence_matrix: { name: { consensus_score: '0.75' } },
          M1: { name: 'Jane' },
          M2: {},
          M3: {},
        },
        // annotated_images deliberately omitted
      }),
    })

    const result = await analyzeDocument(makeFile(), 'rec_456')
    expect(result.m1_image).toBe('')
    expect(result.m2_image).toBe('')
    expect(result.m3_image).toBe('')
  })

  it('returns empty results array when extractions block has no confidence_matrix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ extractions: {}, annotated_images: {} }),
    })

    const result = await analyzeDocument(makeFile(), 'rec_789')
    expect(result.results).toEqual([])
  })
})
