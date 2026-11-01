import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
export const objectSchema = (properties = {}, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const uuidSchema = { type: 'string', format: 'uuid' };
export function validateInput(schema, input) {
  const validate = ajv.compile(schema);
  if (!validate(input)) throw Object.assign(new Error('Parametri non validi per lo strumento.'), { status: 400 });
  return input;
}
export const plainSchema = tool => tool.inputSchema?.jsonSchema || tool.inputSchema;
