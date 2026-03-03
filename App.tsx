import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, TextInput,
  Alert, Modal, ScrollView, StatusBar, ViewStyle, TextStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

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
    connectToTV(ip);
  };

  const tv = clientRef.current;

  // ── Helper: render a button ──
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
          onPress={() => { setIpInput(savedIp); setShowModal(true); }}
          activeOpacity={0.8}
        >
          <Text style={s.connectBtnTxt}>{savedIp ? 'Change TV IP' : 'Set TV IP Address'}</Text>
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
              {/* Row 1 */}
              <View style={s.drow}>
                <View style={s.dspace} />
                <Btn label="▲" onPress={() => tv?.navUp()}  style={s.dBtn} />
                <View style={s.dspace} />
              </View>
              {/* Row 2 */}
              <View style={s.drow}>
                <Btn label="◀" onPress={() => tv?.navLeft()}  style={s.dBtn} />
                <Btn label="OK" onPress={() => tv?.ok()}      style={[s.dBtn, s.okBtn]} />
                <Btn label="▶" onPress={() => tv?.navRight()} style={s.dBtn} />
              </View>
              {/* Row 3 */}
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

      {/* IP modal */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>TV IP Address</Text>
            <Text style={s.modalHint}>
              On your TV go to:{'\n'}
              Settings → Network → Wi-Fi Connection → Advanced Wi-Fi Settings
            </Text>
            <TextInput
              style={s.input}
              value={ipInput}
              onChangeText={setIpInput}
              placeholder="e.g. 192.168.1.105"
              placeholderTextColor="#555"
              keyboardType="default"
              autoFocus
              onSubmitEditing={handleConnect}
            />
            <View style={s.modalRow}>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.cancelBtn}>
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
  modalBox:   { backgroundColor: '#1e1e3f', borderRadius: 16, padding: 24, width: 300 },
  modalTitle: { color: C.white, fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  modalHint:  { color: '#aaa', fontSize: 12, marginBottom: 16, lineHeight: 18 },
  input:      { backgroundColor: C.bg, color: C.white, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: C.divider },
  modalRow:   { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8 },
  modalConnectBtn: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
});
