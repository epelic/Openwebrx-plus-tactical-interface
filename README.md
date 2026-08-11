# OpenWebRX+ Tactical Interface

Current version: **1.2.0**

Customization of OpenWebRX+ for Max Mountain Station but available for all!

Main Features:

- Responsive receiver interface;
- Integrated S-meter and audio spectrum;
- Extended DAB data info panel;
- AM STEREO! It sucks a bit but works!
- DAB+ stereo playback with dynamic support for 32 and 48 kHz;
- Stereo recording at 192 KHz Mp3, 48 KHz
- AM Bandwidth up to 15+15 KHz
- FM stereo and bandwidth adjust.
- Stereo separation adjust.
- FM deviation showed.
- MPX Spectrum.
- Scanner.
- VHF Propagation page.
- Webcam live from here!
- Tastes of chocolate.

<img width="1920" height="1080" alt="2" src="https://github.com/user-attachments/assets/c73d0af7-6af1-4d3e-bae3-ee52acedf791" />

<img width="1898" height="926" alt="image" src="https://github.com/user-attachments/assets/8848fa44-4b3b-462e-aa19-1793749f1336" />

<img width="729" height="327" alt="image" src="https://github.com/user-attachments/assets/1c9f8cc4-9e7c-40f9-80a2-09fcc0ac99ee" />



The csdr modification required for the DAB pipeline is located in
backend/csdr/module/toolbox.py.

The repository does not include receiver configurations,
credentials, or installation-specific data.

You must install the main program before to proceed to install this interface

Download it here: https://fms.komkon.org/OWRX/

Check the new interface live here: http://maxmountainstation.ddns.net:8073/

TO DO LIST:

- Opus stream at 128 Kbs stereo instead than ADPCM
- Resolve the clipping issue on DAB audio when converted by Dablin.

## Automatic installation on Raspberry Pi

This installer is intended for an existing, working Debian/Raspberry Pi OS
installation of OpenWebRX+. It creates a timestamped backup before changing
files, preserves receiver configuration and credentials, installs the web
interface and the DAB stereo csdr module, then restarts OpenWebRX.

```bash
curl -fsSL https://raw.githubusercontent.com/epelic/Openwebrx-plus-tactical-interface/main/install.sh | sudo bash -s -- --yes
```

Run a detection-only test first:

```bash
curl -fsSL https://raw.githubusercontent.com/epelic/Openwebrx-plus-tactical-interface/main/install.sh | sudo bash -s -- --dry-run
```

For the interface only, without modifying the DAB pipeline:

```bash
curl -fsSL https://raw.githubusercontent.com/epelic/Openwebrx-plus-tactical-interface/main/install.sh | sudo bash -s -- --no-backend --yes
```

The backup path is printed at the end of the installation. This customization
tracks the OpenWebRX+ package layout used by the Max Mountain Station; review
the diff and keep a system backup when installing on a different release.

If you like it , why don't offer me a beer? 

https://paypal.me/steelwood?locale.x=it_IT&country.x=IT

# OpenWebRX+ Tactical Interface

Versione corrente: **1.2.0**

Personalizzazione di OpenWebRX+ per Max Mountain Station ma disponibile per tutti!

Contiene:

- interfaccia ricevitore responsive.
- S-meter e spettro audio integrati.
- Pannello dati DAB esteso.
- AM STEREO! Tutto da migliorare ma c'è!
- Riproduzione stereo DAB+ con supporto dinamico per 32 e 48 kHz.
- Registrazione stereo a 192 kHz, MP3 a 48 kHz.
- Larghezza di banda AM fino a 15+15 kHz.
- FM stereo e regolazione della larghezza di banda.
- Regolazione della separazione stereo.
- Deviazione FM visualizzata.
- Spettro MPX.
- Scanner.
- Propagazione VHF inclusa.
- Webcam da qui!
- Sa di cioccolata.

<img width="1920" height="1080" alt="2" src="https://github.com/user-attachments/assets/ae93574f-249c-4368-be32-11f5c4373944" />

<img width="1898" height="926" alt="image" src="https://github.com/user-attachments/assets/14af16ab-6e3a-437a-9830-16782ecb9efd" />

<img width="729" height="327" alt="image" src="https://github.com/user-attachments/assets/3c51b88c-97ae-42ac-b583-1e0d271369c8" />


La modifica csdr necessaria alla pipeline DAB si trova in
`backend/csdr/module/toolbox.py`.

Il repository non include configurazioni del ricevitore, credenziali o dati
specifici dell'installazione.

Devi scaricare openwebrx+ e installarla prima di applicare questa modifica!
Scaricalo qui: https://fms.komkon.org/OWRX/

Qui la nuova interfaccia in funzione: http://maxmountainstation.ddns.net:8073/

## Installazione automatica su Raspberry Pi

Lo script è destinato a un'installazione OpenWebRX+ già funzionante su
Debian/Raspberry Pi OS. Prima di modificare i file crea un backup con data e
ora, conserva configurazioni e credenziali, installa l'interfaccia e il modulo
csdr per il DAB stereo, quindi riavvia OpenWebRX.

```bash
curl -fsSL https://raw.githubusercontent.com/epelic/Openwebrx-plus-tactical-interface/main/install.sh | sudo bash -s -- --yes
```

Per controllare i percorsi senza modificare nulla:

```bash
curl -fsSL https://raw.githubusercontent.com/epelic/Openwebrx-plus-tactical-interface/main/install.sh | sudo bash -s -- --dry-run
```

Per installare soltanto l'interfaccia, senza modificare la pipeline DAB:

```bash
curl -fsSL https://raw.githubusercontent.com/epelic/Openwebrx-plus-tactical-interface/main/install.sh | sudo bash -s -- --no-backend --yes
```

Al termine viene mostrato il percorso del backup. La personalizzazione segue
la struttura del pacchetto OpenWebRX+ usato da Max Mountain Station: su una
release differente è consigliabile controllare il diff e conservare anche un
backup completo del sistema.

Se ti piace, offrimi una birra!

https://paypal.me/steelwood?locale.x=it_IT&country.x=IT
