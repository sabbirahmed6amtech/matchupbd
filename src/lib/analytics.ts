const EVENT_KEY = 'matchupbd_analytics_events'

type AnalyticsEvent = {
  name: string
  at: string
  payload?: Record<string, string | number | boolean>
}

export const trackEvent = (name: string, payload?: Record<string, string | number | boolean>) => {
  const previous = localStorage.getItem(EVENT_KEY)
  const parsed: AnalyticsEvent[] = previous ? JSON.parse(previous) : []

  parsed.push({ name, at: new Date().toISOString(), payload })
  localStorage.setItem(EVENT_KEY, JSON.stringify(parsed.slice(-500)))
}
