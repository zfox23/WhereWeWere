const PHOTON_BASE = 'https://photon.home.zachfox.io';

export interface ReverseGeocodeResult {
  country?: string;
  state?: string;
  city?: string;
}

export interface PlaceSearchResult {
  name: string;
  latitude: number;
  longitude: number;
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  try {
    const res = await fetch(
      `${PHOTON_BASE}/reverse?lon=${lng}&lat=${lat}`
    );
    if (!res.ok) return {};
    const data: any = await res.json();
    
    // Photon returns features array; use the first (most relevant) result
    const features = data.features || [];
    if (features.length === 0) return {};
    
    const feature = features[0];
    const props = feature.properties || {};
    
    return {
      country: props.country,
      state: props.state,
      city: props.city || props.town,
    };
  } catch {
    return {};
  }
}

export async function searchPlacesByName(
  q: string,
  limit: number = 5,
): Promise<PlaceSearchResult[]> {
  const query = q.trim();
  if (!query) return [];

  try {
    const safeLimit = Math.min(Math.max(limit, 1), 10);
    const params = new URLSearchParams({
      q: query,
      limit: String(safeLimit),
    });
    const res = await fetch(`${PHOTON_BASE}/api?${params.toString()}`);
    if (!res.ok) return [];

    const data: any = await res.json();
    const features = data.features || [];

    return features
      .map((feature: any) => {
        const props = feature.properties || {};
        const coords = feature.geometry?.coordinates || [];
        
        if (coords.length < 2) return null;
        
        const longitude = Number(coords[0]);
        const latitude = Number(coords[1]);
        
        if (!props.name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        
        return {
          name: props.name,
          latitude,
          longitude,
        };
      })
      .filter((item: PlaceSearchResult) => item != null);
  } catch {
    return [];
  }
}
