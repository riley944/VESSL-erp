'use client';

import { useRef } from 'react';
import { htsRateFor } from '@/lib/quoteTiers';
import { dutyForCode } from '@/lib/v2QuotePricing';
import { emptyTier } from './quoteForm';

export default function useQuotePricing({ form, setForm, codes, setNotice }) {
  const nextTierKey = useRef(0);
  const clearedDuty = useRef(new Set());

  const updateTier = (index, key, value) => {
    if (key === 'duty') {
      if (value === '') clearedDuty.current.add(index); else clearedDuty.current.delete(index);
    }
    if (key === 'landed' && !form.tiers[index]?.dutyManual && !form.tiers[index]?.__v2LegacyDuty && form.tiers[index]?.duty != null && form.tiers[index]?.duty !== '' && !Number.isFinite(htsRateFor(form.hts, codes))) {
      setNotice('The HTS rate is unavailable or ambiguous. Duty was cleared; enter it manually.');
    }
    setForm(previous => ({ ...previous, tiers: previous.tiers.map((tier, i) => {
      if (i !== index) return tier;
      const updated = { ...tier, [key]: value, ...(key === 'duty' ? { dutyManual: value !== '', __v2LegacyDuty: false } : {}) };
      if (key === 'ship' && value !== (tier.ship || 'ocean')) {
        delete updated.freightDuty;
      }
      if (key === 'freightAir' || key === 'freightOcean') {
        delete updated.freightDuty;
        updated.__v2LegacyDuty = false;
        if (tier.__v2LegacyDuty && !tier.dutyManual) updated.duty = dutyForCode(tier.landed, previous.hts, codes);
      }
      if (key === 'landed' && !tier.dutyManual && !tier.__v2LegacyDuty) updated.duty = dutyForCode(value, previous.hts, codes);
      return updated;
    }) }));
  };
  const changeHts = (code, extra) => {
    if (code === form.hts) return;
    const available = extra ? [...codes, extra] : codes;
    setForm(previous => ({ ...previous, hts: code, tiers: previous.tiers.map(tier => tier.__v2LegacyDuty ? tier : { ...tier, dutyManual: false, duty: dutyForCode(tier.landed, code, available) }) }));
    clearedDuty.current.clear();
    const explanation = !Number.isFinite(htsRateFor(code, available)) ? 'No single HTS rate is available; duty was cleared and may be entered manually.' : 'Duty recalculated for the new HTS code.';
    setNotice(form.invalidTiers ? 'HTS code changed. Existing pricing tiers could not be read and must be reviewed separately.' : `${explanation} Previous manual duty overrides were cleared.${form.tiers.some(tier => tier.__v2LegacyDuty) ? ' Older freight that includes duty was left unchanged.' : ''}`);
  };
  const finishDutyEdit = index => {
    if (!clearedDuty.current.delete(index)) return;
    setForm(previous => ({ ...previous, tiers: previous.tiers.map((tier, i) => i === index && !tier.dutyManual ? { ...tier, duty: dutyForCode(tier.landed, previous.hts, codes) } : tier) }));
  };
  const addTier = () => {
    const key = `new-${nextTierKey.current++}`;
    setForm(previous => ({ ...previous, tiers: [...previous.tiers, { ...emptyTier(), __v2TierKey: key }] }));
  };
  const removeTier = index => {
    if (!window.confirm('Remove this pricing tier, including its size-specific details?')) return;
    clearedDuty.current.clear();
    setForm(previous => ({ ...previous, tiers: previous.tiers.filter((_, i) => i !== index) }));
  };
  return { updateTier, changeHts, finishDutyEdit, addTier, removeTier };
}
