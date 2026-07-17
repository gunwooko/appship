import analytics from '@react-native-firebase/analytics';

export async function trackRoomJoined(roomId: string): Promise<void> {
  await analytics().logEvent('room_joined', { roomId });
}
