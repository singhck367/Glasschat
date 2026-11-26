package com.glasschat.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                            if (on) {
                                for (AudioDeviceInfo device : devices) {
                                    if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                                        audioManager.setCommunicationDevice(device);
                                        break;
                                    }
                                }
                            } else {
                                for (AudioDeviceInfo device : devices) {
                                    if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                                        audioManager.setCommunicationDevice(device);
                                        break;
                                    }
                                }
                            }
                        }
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
                    // Prevent screen and CPU from sleeping during call (essential for Android < 12 and 5+ min calls)
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

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

                            // If no bluetooth, route to Built-in Speaker by default
                            if (!bluetoothActive) {
                                for (AudioDeviceInfo device : devices) {
                                    if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                                        audioManager.setCommunicationDevice(device);
                                        break;
                                    }
                                }
                            }
                        } else {
                            // Android < 12 compatibility fix: ONLY start Bluetooth SCO if a headset is actually connected!
                            try {
                                BluetoothAdapter btAdapter = BluetoothAdapter.getDefaultAdapter();
                                if (btAdapter != null && btAdapter.isEnabled()) {
                                    int headsetStatus = btAdapter.getProfileConnectionState(BluetoothProfile.HEADSET);
                                    if (headsetStatus == BluetoothProfile.STATE_CONNECTED) {
                                        audioManager.startBluetoothSco();
                                        audioManager.setBluetoothScoOn(true);
                                        bluetoothActive = true;
                                    }
                                }
                            } catch (Exception btEx) {
                                btEx.printStackTrace();
                            }
                        }

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
                    // Clear keep screen on flag when call ends
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

                    AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (audioManager != null) {
                        audioManager.setSpeakerphoneOn(false);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            audioManager.clearCommunicationDevice();
                        } else {
                            try {
                                audioManager.stopBluetoothSco();
                                audioManager.setBluetoothScoOn(false);
                            } catch (Exception ignored) {}
                        }
                        audioManager.setMode(AudioManager.MODE_NORMAL);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }
    }

    // Native In-App APK Downloader & Package Installer Bridge
    public class AppInstallerBridge {
        private File downloadedApk = null;

        @JavascriptInterface
        public void startDownload(String downloadUrl) {
            new Thread(() -> {
                InputStream input = null;
                OutputStream output = null;
                HttpURLConnection connection = null;
                try {
                    URL url = new URL(downloadUrl);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setInstanceFollowRedirects(true);
                    connection.connect();

                    if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                        final String errMsg = "Server returned HTTP " + connection.getResponseCode();
                        runOnUiThread(() -> {
                            WebView wv = getBridge().getWebView();
                            if (wv != null) {
                                wv.evaluateJavascript("if (window.__onApkDownloadError) { window.__onApkDownloadError('" + errMsg + "'); }", null);
                            }
                        });
                        return;
                    }

                    int fileLength = connection.getContentLength();
                    File outputDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (outputDir == null) outputDir = getCacheDir();
                    downloadedApk = new File(outputDir, "GlassChat_Update.apk");

                    input = new BufferedInputStream(connection.getInputStream());
                    output = new FileOutputStream(downloadedApk);

                    byte[] data = new byte[8192];
                    long total = 0;
                    int count;
                    int lastReportedPercent = -1;

                    while ((count = input.read(data)) != -1) {
                        total += count;
                        output.write(data, 0, count);

                        if (fileLength > 0) {
                            int percent = (int) (total * 100 / fileLength);
                            if (percent != lastReportedPercent) {
                                lastReportedPercent = percent;
                                final int p = percent;
                                final long downloadedBytes = total;
                                final long totalBytes = fileLength;
                                runOnUiThread(() -> {
                                    WebView wv = getBridge().getWebView();
                                    if (wv != null) {
                                        wv.evaluateJavascript("if (window.__onApkDownloadProgress) { window.__onApkDownloadProgress(" + p + ", " + downloadedBytes + ", " + totalBytes + "); }", null);
                                    }
                                });
                            }
                        }
                    }

                    output.flush();

                    runOnUiThread(() -> {
                        WebView wv = getBridge().getWebView();
                        if (wv != null) {
                            wv.evaluateJavascript("if (window.__onApkDownloadComplete) { window.__onApkDownloadComplete(); }", null);
                        }
                    });

                } catch (Exception e) {
                    final String err = e.getMessage() != null ? e.getMessage() : "Download error";
                    runOnUiThread(() -> {
                        WebView wv = getBridge().getWebView();
                        if (wv != null) {
                            wv.evaluateJavascript("if (window.__onApkDownloadError) { window.__onApkDownloadError('" + err.replace("'", "\\'") + "'); }", null);
                        }
                    });
                } finally {
                    try {
                        if (output != null) output.close();
                        if (input != null) input.close();
                        if (connection != null) connection.disconnect();
                    } catch (Exception ignored) {}
                }
            }).start();
        }

        @JavascriptInterface
        public void installDownloadedApk() {
            runOnUiThread(() -> {
                try {
                    File file = downloadedApk;
                    if (file == null || !file.exists()) {
                        File outputDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                        if (outputDir == null) outputDir = getCacheDir();
                        file = new File(outputDir, "GlassChat_Update.apk");
                    }
                    if (!file.exists()) {
                        return;
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        if (!getPackageManager().canRequestPackageInstalls()) {
                            Intent reqIntent = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                            reqIntent.setData(Uri.parse("package:" + getPackageName()));
                            reqIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(reqIntent);
                            return;
                        }
                    }

                    Uri apkUri = FileProvider.getUriForFile(
                        MainActivity.this, 
                        getPackageName() + ".fileprovider", 
                        file
                    );

                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
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
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

            // Register native AudioBridge into JavaScript window.AndroidAudio
            webView.addJavascriptInterface(new AudioBridge(), "AndroidAudio");

            // Register native AppInstallerBridge into JavaScript window.AndroidInstaller
            webView.addJavascriptInterface(new AppInstallerBridge(), "AndroidInstaller");

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
