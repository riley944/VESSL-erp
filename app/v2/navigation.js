import { CheckSquare, FileText, Package, ClipboardList, Sun, Truck, Ship, Users, ShoppingBag, Factory, Globe, Code, CircleHelp } from 'lucide-react';

// Placeholder counts from the side-navigation mockup; these are not live data.
export const navigation = [
  { group: 'My workspace', items: [
    { label: 'My to-dos', slug: 'todos', icon: CheckSquare, count: 8, tone: 'late' },
  ] },
  { group: 'Work in progress', items: [
    { label: 'Quotes', slug: 'quotes', icon: FileText, count: 7, tone: 'attention' },
    { label: 'Samples', slug: 'samples', icon: Package },
    { label: 'Orders', slug: 'orders', icon: ClipboardList, count: 3, tone: 'attention' },
    { label: 'In production', slug: 'production', icon: Sun, count: 10, tone: 'late' },
    { label: 'Shipments', slug: 'shipments', icon: Truck, count: 6, tone: 'late' },
    { label: 'Freight quotes', slug: 'freight-quotes', icon: Ship, count: 5, tone: 'attention', separator: true },
  ] },
  { group: 'CRM', items: [
    { label: 'Clients', slug: 'clients', icon: Users },
    { label: 'Products', slug: 'products', icon: ShoppingBag },
    { label: 'Factories', slug: 'factories', icon: Factory },
    { label: 'Freight forwarders', slug: 'forwarders', icon: Globe },
    { label: 'Codes', slug: 'codes', icon: Code },
  ] },
];

export const help = { label: 'Help', slug: 'help', icon: CircleHelp };
export const destinations = [...navigation.flatMap(section => section.items), help];
