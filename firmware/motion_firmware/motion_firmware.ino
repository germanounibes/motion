/*
  Motion Studio — firmware para Arduino Mega

  Recebe comandos de texto pela serial (115200 baud, uma linha por comando, terminada em '\n'):

    ATTACH,<id>,<pino>    liga o servo <id> (0..11) ao pino
    MOVE,<id>,<valor>     move o servo (0..180). Servo 360: 90 = parado
    DETACH,<id>           solta o servo

  Erros voltam como uma linha começando com "ERR" (o app mostra na tela).
  Só usa a biblioteca padrão Servo (já vem com a IDE do Arduino).
*/
#include <Servo.h>

const unsigned long BAUD = 115200;
const uint8_t NUM_SERVOS = 12;
const uint8_t LINE_MAX = 32;

Servo servos[NUM_SERVOS];
bool attached[NUM_SERVOS];

char line[LINE_MAX];
uint8_t len = 0;
bool overflow = false;

void setup() {
  Serial.begin(BAUD);
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (overflow) Serial.println(F("ERR linha longa demais"));
      else if (len > 0) {
        line[len] = '\0';
        handle(line);
      }
      len = 0;
      overflow = false;
    } else if (len < LINE_MAX - 1) {
      line[len++] = c;
    } else {
      overflow = true;
    }
  }
}

// Converte o próximo campo (até a vírgula) em inteiro. Devolve false se não houver número.
bool nextInt(char *&p, long &out) {
  if (p == nullptr || *p == '\0') return false;
  char *end;
  out = strtol(p, &end, 10);
  if (end == p) return false;
  p = (*end == ',') ? end + 1 : end;
  return true;
}

void handle(char *cmd) {
  char *comma = strchr(cmd, ',');
  if (comma == nullptr) { Serial.println(F("ERR comando invalido")); return; }
  *comma = '\0';
  char *args = comma + 1;
  long id, value;

  if (!nextInt(args, id) || id < 0 || id >= NUM_SERVOS) {
    Serial.println(F("ERR id invalido"));
    return;
  }

  if (strcmp(cmd, "ATTACH") == 0) {
    if (!nextInt(args, value) || value < 2 || value > 53) {
      Serial.println(F("ERR pino invalido"));
      return;
    }
    if (attached[id]) servos[id].detach();
    servos[id].attach((int)value);
    attached[id] = true;
  } else if (strcmp(cmd, "MOVE") == 0) {
    if (!nextInt(args, value)) { Serial.println(F("ERR valor invalido")); return; }
    if (!attached[id]) { Serial.println(F("ERR servo sem ATTACH")); return; }
    if (value < 0) value = 0;
    if (value > 180) value = 180;
    servos[id].write((int)value);
  } else if (strcmp(cmd, "DETACH") == 0) {
    if (attached[id]) servos[id].detach();
    attached[id] = false;
  } else {
    Serial.println(F("ERR comando desconhecido"));
  }
}
