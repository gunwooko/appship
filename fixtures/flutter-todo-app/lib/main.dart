import 'package:flutter/material.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  runApp(const TodoApp());
}

class TodoApp extends StatelessWidget {
  const TodoApp({super.key});

  Future<void> trackOpen() async {
    await FirebaseAnalytics.instance.logEvent(name: 'app_open');
    final position = await Geolocator.getCurrentPosition();
    debugPrint('position: $position');
  }

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(home: Scaffold());
  }
}
