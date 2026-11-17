import { CheckSquare, FileText, Package, ClipboardList, Sun, Truck, Ship, Users, ShoppingBag, Factory, Globe, Code, CircleHelp } from 'lucide-react';

export const navigation = [
  { group: 'My workspace', items: [
    { label: 'My to-dos', slug: 'todos', icon: CheckSquare },
  ] },
  { group: 'Work in progress', items: [
    { label: 'Quotes', slug: 'quotes', icon: FileText },
    { label: 'Samples', slug: 'samples', icon: Package },
    { label: 'Orders', slug: 'orders', icon: ClipboardList },
    { label: 'In production', slug: 'production', icon: Sun },
    { label: 'Shipments', slug: 'shipments', icon: Truck },
    { label: 'Freight quotes', slug: 'freight-quotes', icon: Ship, separator: true },
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
