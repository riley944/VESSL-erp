import { notFound } from 'next/navigation';
import V2Shell from '../V2Shell';
import { destinations } from '../navigation';
import s from '../v2.module.css';

export default async function SectionPage({ params }) {
  const { section } = await params;
  const destination = destinations.find(item => item.slug === section && item.slug !== 'quotes');
  if (!destination) notFound();

  return <V2Shell><main className={s.main}><h1>{destination.label}</h1><p className={s.description}>This page is coming soon.</p></main></V2Shell>;
}
