import { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const FALLBACK_DEFAULT_CORNER_RADIUS_IN = 0.125;

// Cached across the app session so every PartDrawer instance doesn't refetch
// the same setting — it rarely changes and is edited from Configuration.
let cachedDefaultCornerRadiusIn = null;
let inFlight = null;

// Called after Configuration saves a new default, so already-mounted
// PartDrawer instances in this session pick it up without a page reload.
export const setCachedDefaultCornerRadiusIn = (value) => {
  cachedDefaultCornerRadiusIn = Number(value) || FALLBACK_DEFAULT_CORNER_RADIUS_IN;
};

export const useDefaultCornerRadiusIn = () => {
  const [value, setValue] = useState(cachedDefaultCornerRadiusIn ?? FALLBACK_DEFAULT_CORNER_RADIUS_IN);

  useEffect(() => {
    if (cachedDefaultCornerRadiusIn != null) return;
    if (!inFlight) {
      inFlight = axios.get(`${API_BASE}/settings/fabrication-defaults`)
        .then((res) => {
          cachedDefaultCornerRadiusIn = Number(res.data?.default_corner_radius_in) || FALLBACK_DEFAULT_CORNER_RADIUS_IN;
          return cachedDefaultCornerRadiusIn;
        })
        .catch(() => FALLBACK_DEFAULT_CORNER_RADIUS_IN);
    }
    let cancelled = false;
    inFlight.then((v) => { if (!cancelled) setValue(v); });
    return () => { cancelled = true; };
  }, []);

  return value;
};
