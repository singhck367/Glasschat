package com.glasschat.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 101;

    // JavaScript Audio Bridge for Bluetooth, Loudspeaker, and Earpiece routing
    public class AudioBridge {
        @JavascriptInterface
        public void setSpeakerphoneOn(boolean on) {
            runOnUiThread(() -> {
                try {
                    AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (audioManager != null) {
                        audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                        audioManager.setSpeakerphoneOn(on);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }

        @JavascriptInterface
        public void setCallMode(boolean isVideo) {
            runOnUiThread(() -> {
                try {
                    AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (audioManager != null) {
                        audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                        
                        boolean bluetoothActive = false;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                            for (AudioDeviceInfo device : devices) {
                                if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || 
                                    device.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                                    audioManager.setCommunicationDevice(device);
                                    bluetoothActive = true;
                                    break;
                                }
                            }
                        } else {
                            if (audioManager.isBluetoothScoAvailableOffCall() || audioManager.isBluetoothA2dpOn()) {
                                audioManager.startBluetoothSco();
                                audioManager.setBluetoothScoOn(true);
                                bluetoothActive = true;
                            }
                        }

                        // If Bluetooth connected: route to Bluetooth.
                        // Otherwise: if video or audio call -> loudspeaker by default so audio is clearly audible
                        if (bluetoothActive) {
                            audioManager.setSpeakerphoneOn(false);
                        } else {
                            audioManager.setSpeakerphoneOn(true);
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }

        @JavascriptInterface
        public void endCallAudio() {
            runOnUiThread(() -> {
                try {
                    AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (audioManager != null) {
                        audioManager.setSpeakerphoneOn(false);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            audioManager.clearCommunicationDevice();
                        } else {
                            audioManager.stopBluetoothSco();
                            audioManager.setBluetoothScoOn(false);
                        }
                        audioManager.setMode(AudioManager.MODE_NORMAL);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Explicitly check and request Camera and Audio runtime permissions from Android OS
        checkAndRequestPermissions();

        // Automatically pad root view when Android soft keyboard appears so input is never covered
        View rootView = findViewById(android.R.id.content);
        if (rootView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootView, (v, insets) -> {
                Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
                v.setPadding(0, 0, 0, imeInsets.bottom);
                return insets;
            });
        }

        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // Allow WebRTC audio and video to play automatically without user gesture
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);

            // Register native AudioBridge into JavaScript window.AndroidAudio
            webView.addJavascriptInterface(new AudioBridge(), "AndroidAudio");

            // Automatically grant WebRTC camera and audio permissions to the webview
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        request.grant(request.getResources());
                    });
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.evaluateJavascript(
                    "if (window.__handleAndroidBack) { const handled = window.__handleAndroidBack(); if (!handled && window.Capacitor) { window.Capacitor.Plugins.App?.exitApp(); } } else { window.history.back(); }",
                    null
                );
                return;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        super.onBackPressed();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setSpeakerphoneOn(false);
                audioManager.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception ignored) {}
    }

    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> listPermissionsNeeded = new ArrayList<>();
            String[] basePermissions = {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            };
            for (String p : basePermissions) {
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                    listPermissionsNeeded.add(p);
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    listPermissionsNeeded.add(Manifest.permission.BLUETOOTH_CONNECT);
                }
            }

            if (!listPermissionsNeeded.isEmpty()) {
                ActivityCompat.requestPermissions(this, listPermissionsNeeded.toArray(new String[0]), PERMISSION_REQ_CODE);
            }
        }
    }
}
