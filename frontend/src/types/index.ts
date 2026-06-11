export interface UploadResponse {
  session_id: string
  filename: string
  total_trades: number
  completed: number
  ongoing: number
  symbols: string[]
}

export interface TradeRow {
  trade_id: string
  symbol: string
  status: 'completed' | 'ongoing'
  entry_date: string
  exit_date: string | null
  buy_qty: number
  sell_qty: number
  net_qty: number
  avg_buy: number | null
  avg_sell: number | null
  realized_pl: number | null
  order_count: number
  bot_type: string
}

export interface SymbolSummary {
  symbol: string
  completed: number
  ongoing: number
  trades: string[]
}

export interface OhlcBar {
  time: string
  open: number
  high: number
  low: number
  close: number
}

export interface VolumeBar {
  time: string
  value: number
  color: string
}

export interface PsarPoint {
  time: string
  value: number
}

export interface Marker {
  time: string
  price: number
  qty: number
}

export interface QuartileBox {
  side: 'buy' | 'sell'
  color: string
  price_lo: number
  price_hi: number
  q_levels: number[]
  left_date: string
  right_date: string
}

export interface ChartData {
  trade_id: string
  symbol: string
  ticker: string
  company_name: string
  status: 'completed' | 'ongoing'
  cycle_direction: 'Uptrend' | 'Downtrend'
  entry_date: string
  exit_date: string | null
  candles: OhlcBar[]
  volume: VolumeBar[]
  psar?: PsarPoint[]
  ma10?: PsarPoint[]
  ma200?: PsarPoint[]
  buy_markers: Marker[]
  sell_markers: Marker[]
  avg_buy: number | null
  avg_sell: number | null
  realized_pl: number | null
  buy_qty: number
  sell_qty: number
  net_qty: number
  bot_type: string
  quartile_boxes: QuartileBox[]
  quartile_levels?: {
    upper: number
    lower: number
    middle: number
    range: number
    quartile_step: number
    first_quartile: number
    second_quartile: number
    third_quartile: number
    fourth_quartile: number
  } | null
}

export interface Analytics {
  total_trades: number
  completed_trades: number
  ongoing_trades: number
  wins: number
  losses: number
  win_rate: number
  total_pl: number
  avg_buy: number | null
  avg_sell: number | null
  max_drawdown: number
  symbol_breakdown: SymbolBreakdown[]
  symbol?: string
}

/** A single execution picked from the Executions table, threaded through to the
 * chart so it can highlight the matching pin. `side` + `date` identify the bar;
 * `price` is shown in the badge label. */
export interface SelectedExec {
  date: string
  side: 'buy' | 'sell'
  price: number
}

export interface Execution {
  trade_id: string
  symbol: string
  side: 'buy' | 'sell'
  exec_price: number
  exec_date: string
  qty: number
  bot_type: string
  correct: boolean
  quartile: number | null
}

export interface CorrectExecutions {
  total_executions: number
  correct_executions: number
  correct_pct: number
  buy_total: number
  buy_correct: number
  buy_pct: number
  sell_total: number
  sell_correct: number
  sell_pct: number
  from_date: string | null
  to_date: string | null
  skipped_symbols: string[]
  quartiles: Record<'1' | '2' | '3' | '4', number>
  buy_quartiles: Record<'1' | '2' | '3' | '4', number>
  sell_quartiles: Record<'1' | '2' | '3' | '4', number>
  executions: Execution[]
}

export interface SymbolBreakdown {
  symbol: string
  trades: number
  pl: number
  ongoing: number
}

export interface PrefetchStatusResponse {
  total: number
  cached: number
  failed: number
  done: boolean
}

export interface SessionInfo {
  session_id: string
  filename: string
  uploaded_at: string
  trade_count: number
  symbols: string[]
}
