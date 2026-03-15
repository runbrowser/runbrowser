/**
 * Output helpers — shared across all commands.
 */

/** Format output — plain text or JSON */
export function output(data: Record<string, unknown>, json?: boolean) {
  if (json) {
    console.log(JSON.stringify(data))
  } else {
    const vals = Object.values(data)
    if (vals.length === 1 && (typeof vals[0] === 'string' || typeof vals[0] === 'boolean' || typeof vals[0] === 'number')) {
      console.log(vals[0])
    } else {
      console.log(JSON.stringify(data, null, 2))
    }
  }
}

export function ok(msg: string, json?: boolean) {
  if (json) output({ success: true }, true)
  else console.log(msg)
}

export function die(msg: string): never {
  console.error(`Error: ${msg}`)
  process.exit(1)
}

/**
 * Format tabular data for output.
 */
export function formatTable(
  rows: Record<string, unknown>[],
  columns: string[],
  format: string = 'table',
): string {
  if (rows.length === 0) return '(no data)'

  switch (format) {
    case 'json':
      return JSON.stringify(rows, null, 2)

    case 'csv': {
      const header = columns.join(',')
      const body = rows.map(r => columns.map(c => {
        const v = String(r[c] ?? '')
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v
      }).join(',')).join('\n')
      return `${header}\n${body}`
    }

    case 'md': {
      const header = `| ${columns.join(' | ')} |`
      const sep = `| ${columns.map(() => '---').join(' | ')} |`
      const body = rows.map(r => `| ${columns.map(c => String(r[c] ?? '')).join(' | ')} |`).join('\n')
      return `${header}\n${sep}\n${body}`
    }

    case 'yaml': {
      return rows.map(r => {
        const fields = columns.map(c => `  ${c}: ${JSON.stringify(r[c] ?? '')}`)
        return `- ${fields.join('\n  ')}`
      }).join('\n')
    }

    case 'table':
    default: {
      // Calculate column widths
      const widths = columns.map(c =>
        Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))
      )
      const header = columns.map((c, i) => c.toUpperCase().padEnd(widths[i])).join('  ')
      const sep = widths.map(w => '-'.repeat(w)).join('  ')
      const body = rows.map(r =>
        columns.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ')
      ).join('\n')
      return `${header}\n${sep}\n${body}`
    }
  }
}
