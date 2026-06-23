/** Map a SQL/BigQuery column type to a semantic categorical text-color token. */
export function typeColor(type: string): string {
  switch (type.toUpperCase()) {
    case 'STRING':
    case 'BYTES':
      return 'text-app-cat-green'
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return 'text-app-cat-blue'
    case 'BOOLEAN':
    case 'BOOL':
      return 'text-app-warn'
    case 'TIMESTAMP':
    case 'DATE':
    case 'TIME':
    case 'DATETIME':
      return 'text-app-cat-purple'
    case 'RECORD':
    case 'STRUCT':
      return 'text-app-accent-text'
    default:
      return 'text-app-text-2'
  }
}
