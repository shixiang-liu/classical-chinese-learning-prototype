type StatusCardProps = {
  title: string
  value: string
  detail?: string
}

export function StatusCard({ title, value, detail }: StatusCardProps) {
  return (
    <article className="metric-tile">
      <span>{title}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  )
}
