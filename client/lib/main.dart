import 'package:flutter/material.dart';

import 'app.dart';
import 'core/app_controller.dart';
import 'core/local_store.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ReviewPilotApp(controller: ReviewPilotController(LocalReviewPilotStore())),
  );
}
