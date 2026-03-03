import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, TextInput,
  Alert, Modal, ScrollView, StatusBar, ViewStyle, TextStyle,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as Network from 'expo-network';

// ─── Colours ──────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0f0f23',
  panel:   '#1a1a3e',
  button:  '#1e1e4f',
  accent:  '#e94560',
  power:   '#cc2200',
  white:   '#ffffff',
  grey:    '#888888',
  divider: '#333366',
  green:   '#2ecc71',
};

// ─── LG WebOS TV client ───────────────────────────────────────────────────────
class LGTVClient {
  private ws:       WebSocket | null = null;
  private inputWs:  WebSocket | null = null;
  private tvIp:     string;
  private _clientKey: string | null;
  private msgId = 1;

  onConnected?:    () => void;
  onDisconnected?: () => void;
  onPairing?:      () => void;
  onError?:        (msg: string) => void;

  constructor(ip: string, savedKey: string | null) {
    this.tvIp       = ip;
    this._clientKey = savedKey;
  }

  get clientKey() { return this._clientKey; }

  connect() {
    this.ws = new WebSocket(`ws://${this.tvIp}:3000`);
    this.ws.onopen    = () => this.register();
    this.ws.onmessage = (e) => { try { this.handleMessage(JSON.parse(e.data)); } catch {} };
    this.ws.onerror   = () => this.onError?.(
      `Could not reach TV at ${this.tvIp}.\n\nMake sure:\n• TV is turned on\n• Phone and TV are on the same WiFi`
    );
    this.ws.onclose   = () => this.onDisconnected?.();
  }

  private register() {
    const payload: Record<string, unknown> = {
      forcePairing: false,
      pairingType: 'PROMPT',
      manifest: {
        manifestVersion: 1,
        permissions: [
          'CONTROL_AUDIO', 'CONTROL_INPUT_JOYSTICK', 'CONTROL_POWER',
          'READ_CURRENT_CHANNEL', 'CONTROL_INPUT_MEDIA_PLAYBACK',
          'CONTROL_MOUSE_AND_KEYBOARD', 'LAUNCH', 'APP_TO_APP',
        ],
      },
    };
    if (this._clientKey) payload['client-key'] = this._clientKey;
    this.sendMain({ type: 'register', id: 'register_0', payload });
  }

  private handleMessage(json: Record<string, any>) {
    switch (json.type) {
      case 'registered': {
        const key = json.payload?.['client-key'];
        if (key) this._clientKey = key;
        this.onConnected?.();
        this.sendMain({
          type: 'request',
          id:   'get_input',
          uri:  'ssap://com.webos.service.networkinput/getPointerInputSocket',
        });
        break;
      }
      case 'prompt':
        this.onPairing?.();
        break;
      case 'response': {
        const path = json.payload?.socketPath;
        if (path) this.connectInput(path);
        break;
      }
      case 'error':
        if (json.id === 'register_0')
          this.onError?.('Pairing was rejected by the TV. Please try again.');
        break;
    }
  }

  private connectInput(path: string) {
    this.inputWs = new WebSocket(`ws://${this.tvIp}:3001${path}`);
  }

  private sendMain(obj: object) { this.ws?.send(JSON.stringify(obj)); }

  private btn(name: string) {
    if (this.inputWs?.readyState === WebSocket.OPEN)
      this.inputWs.send(JSON.stringify({ type: 'button', name }));
  }

  private ssap(uri: string) {
    this.sendMain({ type: 'request', id: `cmd_${this.msgId++}`, uri });
  }

  // ── Public buttons ──
  volumeUp()    { this.btn('VOLUMEUP');   }
  volumeDown()  { this.btn('VOLUMEDOWN'); }
  mute()        { this.btn('MUTE');       }
  channelUp()   { this.btn('CHANNELUP');  }
  channelDown() { this.btn('CHANNELDOWN');}
  navUp()       { this.btn('UP');         }
  navDown()     { this.btn('DOWN');       }
  navLeft()     { this.btn('LEFT');       }
  navRight()    { this.btn('RIGHT');      }
  ok()          { this.btn('ENTER');      }
  back()        { this.btn('BACK');       }
  home()        { this.btn('HOME');       }
  powerOff()    { this.ssap('ssap://system/turnOff'); }

  disconnect() {
    this.ws?.close();
    this.inputWs?.close();
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [status,      setStatus]      = useState('Tap below to connect');
  const [connected,   setConnected]   = useState(false);
  const [showModal,   setShowModal]   = useState(false);
  const [ipInput,     setIpInput]     = useState('');
  const [savedIp,     setSavedIp]     = useState('');

  // Discovery state
  const [scanning,     setScanning]     = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [foundTVs,     setFoundTVs]     = useState<string[]>([]);
  const scanCancelRef = useRef(false);

  const clientRef    = useRef<LGTVClient | null>(null);
  const savedKeyRef  = useRef<string | null>(null);

  // Load saved IP on startup
  useEffect(() => {
    AsyncStorage.getItem('tv_ip').then(ip => {
      if (ip) {
        setSavedIp(ip);
        connectToTV(ip);
      }
    });
  }, []);

  const connectToTV = useCallback((ip: string) => {
    clientRef.current?.disconnect();
    setStatus(`Connecting to ${ip}…`);
    setConnected(false);

    const tv = new LGTVClient(ip, savedKeyRef.current);
    tv.onPairing      = () => setStatus('Accept the connection on your TV screen…');
    tv.onConnected    = () => {
      savedKeyRef.current = tv.clientKey;
      setStatus(`Connected  •  ${ip}`);
      setConnected(true);
    };
    tv.onDisconnected = () => { setStatus('Disconnected'); setConnected(false); };
    tv.onError        = (msg) => {
      setStatus('Not connected');
      setConnected(false);
      Alert.alert('Connection Error', msg);
    };
    tv.connect();
    clientRef.current = tv;
  }, []);

  const handleConnect = () => {
    const ip = ipInput.trim();
    if (!ip) return;
    AsyncStorage.setItem('tv_ip', ip);
    setSavedIp(ip);
    setShowModal(false);
    setScanning(false);
    connectToTV(ip);
  };

  const handleSelectTV = (ip: string) => {
    AsyncStorage.setItem('tv_ip', ip);
    setSavedIp(ip);
    setShowModal(false);
    setScanning(false);
    connectToTV(ip);
  };

  // ── Network scan ──────────────────────────────────────────────────────────
  const scanForTVs = async () => {
    setFoundTVs([]);
    setScanProgress(0);
    scanCancelRef.current = false;

    let deviceIp: string;
    try {
      deviceIp = await Network.getIpAddressAsync();
    } catch {
      Alert.alert('Could not get your phone\'s IP address.', 'Make sure WiFi is on.');
      return;
    }

    const parts = deviceIp.split('.');
    if (parts.length !== 4) {
      Alert.alert('Unexpected IP format: ' + deviceIp);
      return;
    }
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;

    setScanning(true);

    const found: string[] = [];
    const total = 254;
    let done = 0;

    const testIP = (i: number): Promise<void> =>
      new Promise((resolve) => {
        if (scanCancelRef.current) { done++; resolve(); return; }
        const ip = `${subnet}.${i}`;
        const ws = new WebSocket(`ws://${ip}:3000`);
        let settled = false;

        const finish = (isTV: boolean) => {
          if (settled) return;
          settled = true;
          done++;
          setScanProgress(Math.round((done / total) * 100));
          if (isTV) {
            found.push(ip);
            setFoundTVs(prev => [...prev, ip]);
          }
          resolve();
        };

        const timer = setTimeout(() => {
          try { ws.close(); } catch {}
          finish(false);
        }, 800);

        ws.onopen = () => {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          finish(true);
        };
        ws.onerror = () => {
          clearTimeout(timer);
          finish(false);
        };
      });

    const BATCH = 25;
    for (let i = 1; i <= 254; i += BATCH) {
      if (scanCancelRef.current) break;
      const indices = Array.from(
        { length: Math.min(BATCH, 255 - i) },
        (_, k) => i + k
      );
      await Promise.all(indices.map(testIP));
    }

    setScanning(false);

    if (!scanCancelRef.current && found.length === 0) {
      Alert.alert(
        'No TVs found',
        'Make sure your LG TV is on and connected to the same WiFi network, then try again.'
      );
    }
  };

  const stopScan = () => {
    scanCancelRef.current = true;
    setScanning(false);
  };

  const tv = clientRef.current;

  // ── Helper: render a remote button ────────────────────────────────────────
  const Btn = ({
    label, onPress, style, textStyle,
  }: {
    label: string;
    onPress: () => void;
    style?: ViewStyle;
    textStyle?: TextStyle;
  }) => (
    <TouchableOpacity style={[s.btn, style]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.btnTxt, textStyle]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={s.root}>
      <ExpoStatusBar style="light" />
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={s.scroll}>

        {/* Header */}
        <Text style={s.title}>LG TV Remote</Text>
        <Text style={s.status}>{status}</Text>

        <TouchableOpacity
          style={s.connectBtn}
          onPress={() => { setIpInput(savedIp); setFoundTVs([]); setScanning(false); setShowModal(true); }}
          activeOpacity={0.8}
        >
          <Text style={s.connectBtnTxt}>{connected ? 'Change TV' : savedIp ? 'Reconnect / Change TV' : 'Connect to TV'}</Text>
        </TouchableOpacity>

        {/* ═══ Remote Panel ═══ */}
        {connected && (
          <View style={s.remote}>

            {/* Power */}
            <TouchableOpacity
              style={s.powerBtn}
              onPress={() =>
                Alert.alert('Turn off TV?', '', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Yes', onPress: () => tv?.powerOff() },
                ])
              }
              activeOpacity={0.8}
            >
              <Text style={[s.btnTxt, { fontSize: 12 }]}>OFF</Text>
            </TouchableOpacity>

            {/* Volume & Channel */}
            <View style={s.row}>
              <View style={s.col}>
                <Text style={s.colLabel}>VOLUME</Text>
                <Btn label="VOL +" onPress={() => tv?.volumeUp()} />
                <Btn label="MUTE"  onPress={() => tv?.mute()}     style={s.accentBtn} />
                <Btn label="VOL -" onPress={() => tv?.volumeDown()} />
              </View>
              <View style={s.vDivider} />
              <View style={s.col}>
                <Text style={s.colLabel}>CHANNEL</Text>
                <Btn label="CH +" onPress={() => tv?.channelUp()} />
                <View style={{ height: 52 }} />
                <Btn label="CH -" onPress={() => tv?.channelDown()} />
              </View>
            </View>

            <View style={s.hDivider} />

            {/* D-Pad */}
            <View style={s.dpad}>
              <View style={s.drow}>
                <View style={s.dspace} />
                <Btn label="▲" onPress={() => tv?.navUp()}  style={s.dBtn} />
                <View style={s.dspace} />
              </View>
              <View style={s.drow}>
                <Btn label="◀" onPress={() => tv?.navLeft()}  style={s.dBtn} />
                <Btn label="OK" onPress={() => tv?.ok()}      style={[s.dBtn, s.okBtn]} />
                <Btn label="▶" onPress={() => tv?.navRight()} style={s.dBtn} />
              </View>
              <View style={s.drow}>
                <View style={s.dspace} />
                <Btn label="▼" onPress={() => tv?.navDown()} style={s.dBtn} />
                <View style={s.dspace} />
              </View>
            </View>

            <View style={s.hDivider} />

            {/* Back & Home */}
            <View style={[s.row, { marginBottom: 0 }]}>
              <Btn label="BACK" onPress={() => tv?.back()} style={s.sysBtn} />
              <View style={{ width: 12 }} />
              <Btn label="HOME" onPress={() => tv?.home()} style={s.sysBtn} />
            </View>

          </View>
        )}
      </ScrollView>

      {/* ── Connect modal ───────────────────────────────────────────────────── */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => { stopScan(); setShowModal(false); }}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Connect to LG TV</Text>

            {/* ─ Auto-discover section ─ */}
            {!scanning && foundTVs.length === 0 && (
              <TouchableOpacity style={s.searchBtn} onPress={scanForTVs} activeOpacity={0.8}>
                <Text style={s.searchBtnTxt}>Search for TV automatically</Text>
              </TouchableOpacity>
            )}

            {/* Scanning progress */}
            {scanning && (
              <View style={s.scanBox}>
                <ActivityIndicator color={C.accent} size="small" />
                <Text style={s.scanText}>Scanning network… {scanProgress}%</Text>
                <View style={s.progressBar}>
                  <View style={[s.progressFill, { width: `${scanProgress}%` as any }]} />
                </View>
                {foundTVs.length > 0 && (
                  <Text style={s.foundWhileScanning}>{foundTVs.length} TV{foundTVs.length > 1 ? 's' : ''} found so far</Text>
                )}
                <TouchableOpacity onPress={stopScan} style={s.stopBtn}>
                  <Text style={{ color: C.grey, fontSize: 12 }}>Stop</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Found TV list */}
            {foundTVs.length > 0 && (
              <View style={s.foundList}>
                <Text style={s.foundLabel}>Found TV{foundTVs.length > 1 ? 's' : ''} — tap to connect:</Text>
                {foundTVs.map(ip => (
                  <TouchableOpacity key={ip} style={s.foundItem} onPress={() => handleSelectTV(ip)} activeOpacity={0.8}>
                    <Text style={s.foundItemTxt}>📺  {ip}</Text>
                  </TouchableOpacity>
                ))}
                {!scanning && (
                  <TouchableOpacity onPress={scanForTVs} style={s.rescanBtn}>
                    <Text style={{ color: C.grey, fontSize: 12 }}>Search again</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Divider */}
            <View style={s.orRow}>
              <View style={s.orLine} />
              <Text style={s.orTxt}>or enter IP manually</Text>
              <View style={s.orLine} />
            </View>

            <Text style={s.modalHint}>
              TV → Settings → Network → Wi-Fi → Advanced Wi-Fi Settings
            </Text>
            <TextInput
              style={s.input}
              value={ipInput}
              onChangeText={setIpInput}
              placeholder="e.g. 192.168.1.105"
              placeholderTextColor="#555"
              keyboardType="default"
              onSubmitEditing={handleConnect}
            />
            <View style={s.modalRow}>
              <TouchableOpacity onPress={() => { stopScan(); setShowModal(false); }} style={s.cancelBtn}>
                <Text style={{ color: C.grey, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConnectBtn} onPress={handleConnect} activeOpacity={0.8}>
                <Text style={s.btnTxt}>Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: C.bg },
  scroll: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },

  title:  { color: C.white, fontSize: 26, fontWeight: 'bold', letterSpacing: 0.5, marginBottom: 6 },
  status: { color: C.grey,  fontSize: 13, marginBottom: 16, textAlign: 'center' },

  connectBtn:    { backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 12, marginBottom: 28 },
  connectBtnTxt: { color: C.white, fontWeight: 'bold', fontSize: 15 },

  remote:   { backgroundColor: C.panel, borderRadius: 28, padding: 20, width: 280, alignItems: 'center' },
  powerBtn: { backgroundColor: C.power, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },

  row:    { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  col:    { flex: 1, alignItems: 'center' },
  colLabel: { color: '#999', fontSize: 10, letterSpacing: 1, marginBottom: 6 },
  vDivider: { width: 1, height: 140, backgroundColor: C.divider, marginHorizontal: 8 },
  hDivider: { width: '100%', height: 1, backgroundColor: C.divider, marginBottom: 20 },

  btn:      { backgroundColor: C.button, borderRadius: 8, width: 80, height: 44, justifyContent: 'center', alignItems: 'center', marginVertical: 2 },
  btnTxt:   { color: C.white, fontWeight: 'bold', fontSize: 13 },
  accentBtn:{ backgroundColor: C.accent },

  dpad:   { marginBottom: 20 },
  drow:   { flexDirection: 'row' },
  dBtn:   { width: 68, height: 68, borderRadius: 34, margin: 2 },
  dspace: { width: 68, height: 68, margin: 2 },
  okBtn:  { backgroundColor: C.accent },

  sysBtn: { flex: 1, borderRadius: 12 },

  // Modal
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
  modalBox:   { backgroundColor: '#1e1e3f', borderRadius: 16, padding: 24, width: 310 },
  modalTitle: { color: C.white, fontSize: 18, fontWeight: 'bold', marginBottom: 14 },
  modalHint:  { color: '#aaa', fontSize: 11, marginBottom: 10, lineHeight: 16 },
  input:      { backgroundColor: C.bg, color: C.white, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: C.divider },
  modalRow:   { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8 },
  modalConnectBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },

  // Search button
  searchBtn:    { backgroundColor: C.green, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 14 },
  searchBtnTxt: { color: C.white, fontWeight: 'bold', fontSize: 14 },

  // Scanning
  scanBox:   { backgroundColor: C.bg, borderRadius: 10, padding: 14, marginBottom: 14, alignItems: 'center' },
  scanText:  { color: C.grey, fontSize: 13, marginTop: 8, marginBottom: 8 },
  progressBar:  { width: '100%', height: 4, backgroundColor: C.divider, borderRadius: 2, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 4, backgroundColor: C.accent, borderRadius: 2 },
  foundWhileScanning: { color: C.green, fontSize: 12, marginBottom: 4 },
  stopBtn:   { marginTop: 4 },

  // Found TVs
  foundList:    { backgroundColor: C.bg, borderRadius: 10, padding: 10, marginBottom: 14 },
  foundLabel:   { color: '#aaa', fontSize: 11, marginBottom: 8 },
  foundItem:    { backgroundColor: C.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 6 },
  foundItemTxt: { color: C.white, fontWeight: 'bold', fontSize: 15 },
  rescanBtn:    { alignItems: 'center', paddingTop: 6 },

  // Or divider
  orRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: C.divider },
  orTxt:  { color: '#555', fontSize: 11, marginHorizontal: 10 },
});
