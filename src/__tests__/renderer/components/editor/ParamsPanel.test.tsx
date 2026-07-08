import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ParamsPanel from '@renderer/components/editor/ParamsPanel'
import type { QueryParam } from '@shared/types'

afterEach(cleanup)

const params: QueryParam[] = [
  { name: 'country', type: 'text', value: '' },
  { name: 'minRevenue', type: 'number', value: '10' },
]

describe('ParamsPanel errors', () => {
  it('shows no error text when errors is empty', () => {
    render(<ParamsPanel params={params} errors={{}} onChange={() => {}} />)
    expect(screen.queryByText(/before running/)).toBeNull()
  })

  it('renders the error message for an errored param and marks the input', () => {
    render(
      <ParamsPanel
        params={params}
        errors={{ country: 'Fill in {{country}} before running.' }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('Fill in {{country}} before running.')).toBeTruthy()
    // The errored row's input is marked for focus targeting.
    expect(document.querySelector('[data-error="true"]')).toBeTruthy()
  })
})
