import { useEffect, useMemo, useState } from "react";
import { GoogleMap, DirectionsRenderer, Marker, useJsApiLoader } from "@react-google-maps/api";
import { getGoogleMapsApiKey } from "@/services/googleMaps";
import { Loader2, MapPin, Navigation } from "lucide-react";

export interface OrderRoutePanelProps {
  storeAddress?: { lat: number; lng: number };
  deliveryAddress?: { lat: number; lng: number };
  distanceKm?: number;
  estimatedMin?: number;
  estimatedMax?: number;
  className?: string;
}

const mapContainerStyle = { width: "100%", height: "220px" };

export const OrderRoutePanel = ({
  storeAddress,
  deliveryAddress,
  distanceKm,
  estimatedMin,
  estimatedMax,
  className,
}: OrderRoutePanelProps) => {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    language: "pt-BR",
  });

  const [directions, setDirections] = useState<any>(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);

  useEffect(() => {
    if (!isLoaded || !storeAddress || !deliveryAddress) return;

    const directionsService = new google.maps.DirectionsService();
    setDirectionsLoading(true);
    directionsService.route(
      {
        origin: storeAddress,
        destination: deliveryAddress,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK") {
          setDirections(result);
        }
        setDirectionsLoading(false);
      },
    );
  }, [isLoaded, storeAddress, deliveryAddress]);

  if (!apiKey) {
    return (
      <div className={`rounded-lg border border-dashed border-border bg-muted/30 p-4 ${className || ""}`}>
        <div className="text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-1 h-5 w-5" />
          <p>Chave do Google Maps não configurada.</p>
        </div>
      </div>
    );
  }

  if (!storeAddress || !deliveryAddress) {
    return (
      <div className={`rounded-lg border border-dashed border-border bg-muted/30 p-4 ${className || ""}`}>
        <div className="text-center text-sm text-muted-foreground">
          <Navigation className="mx-auto mb-1 h-5 w-5" />
          <p>Coordenadas de entrega não disponíveis.</p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={`flex h-[220px] items-center justify-center rounded-lg border border-border bg-muted/30 ${className || ""}`}>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className || ""}`}>
      {/* Route info */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <div className="flex items-center gap-1.5">
          <Navigation className="h-4 w-4 text-primary" />
          <span className="font-semibold">{distanceKm?.toFixed(1)} km</span>
        </div>
        {estimatedMin && estimatedMax && (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-blue-700">{estimatedMin}-{estimatedMax} min</span>
          </div>
        )}
        {directionsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Mini map */}
      <div className="overflow-hidden rounded-lg border border-border">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={storeAddress}
          zoom={14}
          options={{
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            zoomControl: false,
          }}
        >
          <Marker position={storeAddress} label="L" title="Loja" />
          <Marker position={deliveryAddress} label="C" title="Cliente" />
          {directions && <DirectionsRenderer directions={directions} options={{ suppressMarkers: true }} />}
        </GoogleMap>
      </div>
    </div>
  );
};
