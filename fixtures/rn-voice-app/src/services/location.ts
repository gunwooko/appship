import Geolocation from 'react-native-geolocation-service';

export function getCurrentLocation(onDone: (lat: number, lng: number) => void): void {
  Geolocation.getCurrentPosition(
    (position) => onDone(position.coords.latitude, position.coords.longitude),
    () => onDone(0, 0),
    { enableHighAccuracy: true },
  );
}
