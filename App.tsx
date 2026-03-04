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

// ─── Full pairing payload (from lgtv2 — TV validates the RSA signature) ───────
const PAIRING_PAYLOAD = {
  forcePairing: false,
  pairingType: 'PROMPT',
  manifest: {
    manifestVersion: 1,
    appVersion: '1.1',
    signed: {
      created: '20140509',
      appId: 'com.lge.test',
      vendorId: 'com.lge',
      localizedAppNames: {
        '': 'LG Remote App',
        'ko-KR': '리모컨 앱',
        'zxx-XX': 'ЛГ Rэмotэ AПП',
      },
      localizedVendorNames: { '': 'LG Electronics' },
      permissions: [
        'TEST_SECURE', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD',
        'READ_INSTALLED_APPS', 'READ_LGE_SDX', 'READ_NOTIFICATIONS', 'SEARCH',
        'WRITE_SETTINGS', 'WRITE_NOTIFICATION_ALERT', 'CONTROL_POWER',
        'READ_CURRENT_CHANNEL', 'READ_RUNNING_APPS', 'READ_UPDATE_INFO',
        'UPDATE_FROM_REMOTE_APP', 'READ_LGE_TV_INPUT_EVENTS', 'READ_TV_CURRENT_TIME',
      ],
      serial: '2f930e2d2cfe083771f68e4fe7bb07',
    },
    permissions: [
      'LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'TEST_OPEN', 'TEST_PROTECTED',
      'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK',
      'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_MEDIA_PLAYBACK',
      'CONTROL_INPUT_TV', 'CONTROL_POWER', 'READ_APP_STATUS', 'READ_CURRENT_CHANNEL',
      'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE', 'READ_RUNNING_APPS',
      'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_POWER_STATE',
      'READ_COUNTRY_INFO', 'READ_SETTINGS', 'CONTROL_TV_SCREEN', 'CONTROL_TV_STANBY',
      'CONTROL_FAVORITE_GROUP', 'CONTROL_USER_INFO', 'CHECK_BLUETOOTH_DEVICE',
      'CONTROL_BLUETOOTH', 'CONTROL_TIMER_INFO', 'STB_INTERNAL_CONNECTION',
      'CONTROL_RECORDING', 'READ_RECORDING_STATE', 'WRITE_RECORDING_LIST',
      'READ_RECORDING_LIST', 'READ_RECORDING_SCHEDULE', 'WRITE_RECORDING_SCHEDULE',
      'READ_STORAGE_DEVICE_LIST', 'READ_TV_PROGRAM_INFO', 'CONTROL_BOX_CHANNEL',
      'READ_TV_ACR_AUTH_TOKEN', 'READ_TV_CONTENT_STATE', 'READ_TV_CURRENT_TIME',
      'ADD_LAUNCHER_CHANNEL', 'SET_CHANNEL_SKIP', 'RELEASE_CHANNEL_SKIP',
      'CONTROL_CHANNEL_BLOCK', 'DELETE_SELECT_CHANNEL', 'CONTROL_CHANNEL_GROUP',
      'SCAN_TV_CHANNELS', 'CONTROL_TV_POWER', 'CONTROL_WOL',
    ],
    signatures: [
      {
        signatureVersion: 1,
        signature: 'eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==',
      },
    ],
  },
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
    // Try ws:// port 3000 first (works on most TVs)
    this.ws = new WebSocket(`ws://${this.tvIp}:3000`);
    this.ws.onopen    = () => this.register();
    this.ws.onmessage = (e) => { try { this.handleMessage(JSON.parse(e.data)); } catch {} };
    this.ws.onerror   = () => this.onError?.(
      `Could not reach TV at ${this.tvIp}.\n\nMake sure:\n• TV is turned on\n• Phone and TV are on the same WiFi\n• On TV: Settings → All Settings → General → Devices → TV Management → Quick Start+ → ON`
    );
    this.ws.onclose   = () => this.onDisconnected?.();
  }

  private register() {
    const payload: Record<string, unknown> = { ...PAIRING_PAYLOAD };
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

  const [scanning,     setScanning]     = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanNote,     setScanNote]     = useState('');
  const [foundTVs,     setFoundTVs]     = useState<string[]>([]);
  const scanCancelRef = useRef(false);

  const clientRef   = useRef<LGTVClient | null>(null);
  const savedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('tv_ip').then(ip => {
      if (ip) { setSavedIp(ip); connectToTV(ip); }
    });
  }, []);

  const connectToTV = useCallback((ip: string) => {
    clientRef.current?.disconnect();
    setStatus(`Connecting to ${ip}…`);
    setConnected(false);

    const tv = new LGTVClient(ip, savedKeyRef.current);
    tv.onPairing      = () => setStatus('Check your TV — accept the connection popup…');
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

  // ── Network scan ─────────────────────────────────────────────────────────
  // LG TV port 3000 responds with "Hello world" to plain HTTP GET
  // so fetch() is reliable: resolves = port open = TV found
  const scanForTVs = async () => {
    setFoundTVs([]);
    setScanProgress(0);
    setScanNote('Detecting your network…');
    scanCancelRef.current = false;
    setScanning(true);

    let phoneIp = '';
    try { phoneIp = (await Network.getIpAddressAsync()) ?? ''; } catch {}

    // Build subnets to scan: detected subnet + common fallbacks
    const subnets: string[] = [];
    if (phoneIp && phoneIp !== '0.0.0.0' && phoneIp !== '127.0.0.1') {
      const p = phoneIp.split('.');
      if (p.length === 4) subnets.push(`${p[0]}.${p[1]}.${p[2]}`);
    }
    for (const s of ['192.168.1', '192.168.0', '10.0.0']) {
      if (!subnets.includes(s)) subnets.push(s);
    }

    const infoLine = phoneIp && phoneIp !== '0.0.0.0'
      ? `Phone IP: ${phoneIp}`
      : 'Scanning common subnets';

    const found: string[] = [];
    const total = subnets.length * 254;
    let done = 0;

    const probe = (ip: string): Promise<void> =>
      new Promise((resolve) => {
        if (scanCancelRef.current) { done++; resolve(); return; }

        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
          done++;
          setScanProgress(Math.round((done / total) * 100));
          resolve();
        }, 1500);

        // Port 3000: LG TV responds "Hello world" to plain HTTP
        fetch(`http://${ip}:3000`, { signal: controller.signal })
          .then(() => {
            clearTimeout(timer);
            if (!found.includes(ip)) {
              found.push(ip);
              setFoundTVs(prev => [...prev, ip]);
            }
            done++;
            setScanProgress(Math.round((done / total) * 100));
            resolve();
          })
          .catch((e: any) => {
            clearTimeout(timer);
            const msg: string = e?.message ?? '';
            const isAbort = e?.name === 'AbortError' || msg.includes('aborted');
            const isNetErr = msg.includes('Network request failed') || msg.includes('Failed to fetch');
            // If it's neither a timeout nor a plain "no connection" error, the port responded somehow
            if (!isAbort && !isNetErr) {
              if (!found.includes(ip)) {
                found.push(ip);
                setFoundTVs(prev => [...prev, ip]);
              }
            }
            done++;
            setScanProgress(Math.round((done / total) * 100));
            resolve();
          });
      });

    const BATCH = 10;
    for (const subnet of subnets) {
      if (scanCancelRef.current) break;
      setScanNote(`${infoLine} — scanning ${subnet}.x`);
      for (let i = 1; i <= 254; i += BATCH) {
        if (scanCancelRef.current) break;
        const batch = Array.from(
          { length: Math.min(BATCH, 255 - i) },
          (_, k) => `${subnet}.${i + k}`
        );
        await Promise.all(batch.map(probe));
      }
    }

    setScanning(false);
    setScanNote('');

    if (!scanCancelRef.current && found.length === 0) {
      Alert.alert(
        'No TVs found',
        (phoneIp && phoneIp !== '0.0.0.0' ? `Your phone IP: ${phoneIp}\n\n` : '') +
        'Please check on the TV:\n\n' +
        '1. Quick Start+ is ON:\n   Settings → All Settings → General → Devices → TV Management → Quick Start+\n\n' +
        '2. LG Connect Apps is ON:\n   Settings → Network → LG Connect Apps\n\n' +
        '3. Both phone and TV are on the same WiFi network\n\n' +
        'Or enter the TV IP manually below.'
      );
    }
  };

  const stopScan = () => {
    scanCancelRef.current = true;
    setScanning(false);
    setScanNote('');
  };

  const tv = clientRef.current;

  const Btn = ({
    label, onPress, style, textStyle,
  }: {
    label: string; onPress: () => void; style?: ViewStyle; textStyle?: TextStyle;
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
        <Text style={s.title}>LG TV Remote</Text>
        <Text style={s.status}>{status}</Text>

        <TouchableOpacity
          style={s.connectBtn}
          onPress={() => { setIpInput(savedIp); setFoundTVs([]); setScanning(false); setScanNote(''); setShowModal(true); }}
          activeOpacity={0.8}
        >
          <Text style={s.connectBtnTxt}>
            {connected ? 'Change TV' : savedIp ? 'Reconnect / Change TV' : 'Connect to TV'}
          </Text>
        </TouchableOpacity>

        {connected && (
          <View style={s.remote}>
            <TouchableOpacity
              style={s.powerBtn}
              onPress={() => Alert.alert('Turn off TV?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Yes', onPress: () => tv?.powerOff() },
              ])}
              activeOpacity={0.8}
            >
              <Text style={[s.btnTxt, { fontSize: 12 }]}>OFF</Text>
            </TouchableOpacity>

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

            <View style={s.dpad}>
              <View style={s.drow}>
                <View style={s.dspace} />
                <Btn label="▲" onPress={() => tv?.navUp()}    style={s.dBtn} />
                <View style={s.dspace} />
              </View>
              <View style={s.drow}>
                <Btn label="◀" onPress={() => tv?.navLeft()}  style={s.dBtn} />
                <Btn label="OK" onPress={() => tv?.ok()}      style={[s.dBtn, s.okBtn]} />
                <Btn label="▶" onPress={() => tv?.navRight()} style={s.dBtn} />
              </View>
              <View style={s.drow}>
                <View style={s.dspace} />
                <Btn label="▼" onPress={() => tv?.navDown()}  style={s.dBtn} />
                <View style={s.dspace} />
              </View>
            </View>

            <View style={s.hDivider} />

            <View style={[s.row, { marginBottom: 0 }]}>
              <Btn label="BACK" onPress={() => tv?.back()} style={s.sysBtn} />
              <View style={{ width: 12 }} />
              <Btn label="HOME" onPress={() => tv?.home()} style={s.sysBtn} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Connect modal ────────────────────────────────────────────────────── */}
      <Modal
        visible={showModal} transparent animationType="fade"
        onRequestClose={() => { stopScan(); setShowModal(false); }}
      >
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Connect to LG TV</Text>

            {!scanning && foundTVs.length === 0 && (
              <TouchableOpacity style={s.searchBtn} onPress={scanForTVs} activeOpacity={0.8}>
                <Text style={s.searchBtnTxt}>Search for TV automatically</Text>
              </TouchableOpacity>
            )}

            {scanning && (
              <View style={s.scanBox}>
                <ActivityIndicator color={C.accent} size="small" />
                <Text style={s.scanPct}>{scanProgress}%</Text>
                <View style={s.progressBar}>
                  <View style={[s.progressFill, { width: `${scanProgress}%` as any }]} />
                </View>
                {scanNote ? <Text style={s.scanNote}>{scanNote}</Text> : null}
                {foundTVs.length > 0 && (
                  <Text style={s.foundWhile}>{foundTVs.length} TV{foundTVs.length > 1 ? 's' : ''} found!</Text>
                )}
                <TouchableOpacity onPress={stopScan} style={s.stopBtn}>
                  <Text style={{ color: C.grey, fontSize: 12 }}>Stop</Text>
                </TouchableOpacity>
              </View>
            )}

            {foundTVs.length > 0 && (
              <View style={s.foundList}>
                <Text style={s.foundLabel}>Tap to connect:</Text>
                {foundTVs.map(ip => (
                  <TouchableOpacity key={ip} style={s.foundItem} onPress={() => handleSelectTV(ip)} activeOpacity={0.8}>
                    <Text style={s.foundItemTxt}>TV at {ip}</Text>
                  </TouchableOpacity>
                ))}
                {!scanning && (
                  <TouchableOpacity onPress={scanForTVs} style={s.rescanBtn}>
                    <Text style={{ color: C.grey, fontSize: 12 }}>Search again</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={s.orRow}>
              <View style={s.orLine} />
              <Text style={s.orTxt}>or enter IP manually</Text>
              <View style={s.orLine} />
            </View>

            <Text style={s.modalHint}>TV → Settings → Network → Wi-Fi → Advanced Wi-Fi Settings</Text>
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
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  title:  { color: C.white, fontSize: 26, fontWeight: 'bold', letterSpacing: 0.5, marginBottom: 6 },
  status: { color: C.grey,  fontSize: 13, marginBottom: 16, textAlign: 'center' },
  connectBtn:    { backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 12, marginBottom: 28 },
  connectBtnTxt: { color: C.white, fontWeight: 'bold', fontSize: 15 },
  remote:   { backgroundColor: C.panel, borderRadius: 28, padding: 20, width: 280, alignItems: 'center' },
  powerBtn: { backgroundColor: C.power, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  row:      { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  col:      { flex: 1, alignItems: 'center' },
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
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
  modalBox:   { backgroundColor: '#1e1e3f', borderRadius: 16, padding: 24, width: 310 },
  modalTitle: { color: C.white, fontSize: 18, fontWeight: 'bold', marginBottom: 14 },
  modalHint:  { color: '#aaa', fontSize: 11, marginBottom: 10, lineHeight: 16 },
  input:      { backgroundColor: C.bg, color: C.white, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: C.divider },
  modalRow:   { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8 },
  modalConnectBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  searchBtn:    { backgroundColor: C.green, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 14 },
  searchBtnTxt: { color: C.white, fontWeight: 'bold', fontSize: 14 },
  scanBox:    { backgroundColor: C.bg, borderRadius: 10, padding: 14, marginBottom: 14, alignItems: 'center' },
  scanPct:    { color: C.white, fontSize: 20, fontWeight: 'bold', marginTop: 8 },
  progressBar:  { width: '100%', height: 4, backgroundColor: C.divider, borderRadius: 2, overflow: 'hidden', marginTop: 6, marginBottom: 8 },
  progressFill: { height: 4, backgroundColor: C.accent, borderRadius: 2 },
  scanNote:   { color: C.grey, fontSize: 11, textAlign: 'center', marginBottom: 4 },
  foundWhile: { color: C.green, fontSize: 12, marginBottom: 4 },
  stopBtn:    { marginTop: 6 },
  foundList:    { backgroundColor: C.bg, borderRadius: 10, padding: 10, marginBottom: 14 },
  foundLabel:   { color: '#aaa', fontSize: 11, marginBottom: 8 },
  foundItem:    { backgroundColor: C.accent, borderRadius: 8, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 6, alignItems: 'center' },
  foundItemTxt: { color: C.white, fontWeight: 'bold', fontSize: 15 },
  rescanBtn:    { alignItems: 'center', paddingTop: 6 },
  orRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: C.divider },
  orTxt:  { color: '#555', fontSize: 11, marginHorizontal: 10 },
});
