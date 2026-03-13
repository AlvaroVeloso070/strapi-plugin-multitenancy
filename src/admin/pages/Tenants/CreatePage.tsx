import React, { useState } from 'react';
import {
  Button,
  Flex,
  Grid,
  TextInput,
  Field,
} from '@strapi/design-system';
import { Check, ArrowLeft } from '@strapi/icons';
import {
  Page,
  useNotification,
  useFetchClient,
  Layouts,
} from '@strapi/strapi/admin';
import { Formik, Form } from 'formik';
import { useIntl } from 'react-intl';
import { useMutation } from 'react-query';
import { useNavigate } from 'react-router-dom';

import pluginId from '../../pluginId';
import { getTenantsUrl } from '../../utils/api';

const validate = (values: any) => {
  const errors: any = {};
  if (!values.slug) errors.slug = 'Required';
  else if (!/^[a-z0-9-]+$/.test(values.slug)) {
    errors.slug = 'Only lowercase letters, numbers, and hyphens';
  }
  if (!values.name) errors.name = 'Required';
  if (!values.schema) errors.schema = 'Required';
  else if (!/^[a-z0-9_-]+$/.test(values.schema)) {
    errors.schema = 'Only lowercase letters, numbers, underscores, and hyphens';
  }
  return errors;
};

const TenantCreatePage = () => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = (useNotification as any)();
  const navigate = useNavigate();
  const { post } = (useFetchClient as any)();
  const [schemaManuallySet, setSchemaManuallySet] = useState(false);

  const mutation = (useMutation as any)({
    mutationFn: (body: any) => post(getTenantsUrl(), body),
    onSuccess: () => {
      toggleNotification({
        type: 'success',
        message: formatMessage({
          id: `${pluginId}.tenant.created`,
          defaultMessage: 'Tenant created successfully',
        }),
      });
      navigate('..');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message ?? err?.message;
      toggleNotification({
        type: 'danger',
        message: msg || formatMessage({
          id: `${pluginId}.error`,
          defaultMessage: 'Error creating tenant',
        }),
      });
    },
  });

  const Hint = (Field as any).Hint;

  return (
    <Page.Main>
      <Page.Title>
        {formatMessage(
          { id: 'Settings.PageTitle', defaultMessage: 'Settings - {name}' },
          { name: formatMessage({ id: `${pluginId}.add`, defaultMessage: 'Add tenant' }) }
        )}
      </Page.Title>
      <Formik
        initialValues={{ slug: '', name: '', schema: '' }}
        validate={validate}
        onSubmit={(values) => mutation.mutate(values)}
      >
        {({ handleSubmit, values, handleBlur, setFieldValue, errors }: any) => (
          <Form noValidate onSubmit={handleSubmit}>
            <Layouts.Header
              primaryAction={
                <Button
                  type="submit"
                  loading={mutation.isLoading}
                  startIcon={<Check />}
                >
                  {formatMessage({ id: 'global.save', defaultMessage: 'Save' })}
                </Button>
              }
              title={formatMessage({
                id: `${pluginId}.create.title`,
                defaultMessage: 'Create tenant',
              })}
              subtitle={formatMessage({
                id: `${pluginId}.create.subtitle`,
                defaultMessage: 'The slug identifies the tenant by subdomain. The schema name is permanent.',
              })}
              navigationAction={
                <Button variant="tertiary" onClick={() => navigate('..')} startIcon={<ArrowLeft />} size="S">
                  {formatMessage({ id: 'global.back', defaultMessage: 'Back' })}
                </Button>
              }
            />
            <Layouts.Content>
              <Flex
                direction="column"
                alignItems="stretch"
                gap={7}
                background="neutral0"
                hasRadius
                paddingTop={6}
                paddingBottom={6}
                paddingLeft={7}
                paddingRight={7}
                shadow="filterShadow"
              >
                <Grid.Root gap={4}>
                  <Grid.Item col={6} xs={12}>
                    <Field.Root
                      name="slug"
                      error={errors.slug as any}
                      required
                    >
                      <Field.Label>
                        {formatMessage({ id: 'global.slug', defaultMessage: 'Slug' })}
                      </Field.Label>
                      <TextInput
                        name="slug"
                        value={values.slug || ''}
                        onChange={(e: any) => {
                          const val = e.target.value;
                          setFieldValue('slug', val);
                          if (!schemaManuallySet) {
                            setFieldValue('schema', val);
                          }
                        }}
                        onBlur={handleBlur}
                        placeholder="acme"
                      />
                      <Hint>
                        {formatMessage({
                          id: `${pluginId}.slug.hint`,
                          defaultMessage: 'Subdomain identifier — can be changed later (e.g.: acme → acme.localhost)',
                        })}
                      </Hint>
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                  <Grid.Item col={6} xs={12}>
                    <Field.Root
                      name="name"
                      error={errors.name as any}
                      required
                    >
                      <Field.Label>
                        {formatMessage({ id: 'global.name', defaultMessage: 'Name' })}
                      </Field.Label>
                      <TextInput
                        name="name"
                        value={values.name || ''}
                        onChange={(e: any) => setFieldValue('name', e.target.value)}
                        onBlur={handleBlur}
                        placeholder="Acme Corp"
                      />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                  <Grid.Item col={6} xs={12}>
                    <Field.Root
                      name="schema"
                      error={errors.schema as any}
                      required
                    >
                      <Field.Label>
                        {formatMessage({ id: `${pluginId}.schema`, defaultMessage: 'Schema Name' })}
                      </Field.Label>
                      <TextInput
                        name="schema"
                        value={values.schema || ''}
                        onChange={(e: any) => {
                          setSchemaManuallySet(true);
                          setFieldValue('schema', e.target.value);
                        }}
                        onBlur={handleBlur}
                        placeholder="acme"
                      />
                      <Hint>
                        {formatMessage({
                          id: `${pluginId}.schema.hint`,
                          defaultMessage: 'PostgreSQL schema name — permanent, cannot be changed after creation',
                        })}
                      </Hint>
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                </Grid.Root>
              </Flex>
            </Layouts.Content>
          </Form>
        )}
      </Formik>
    </Page.Main>
  );
};

export default TenantCreatePage;
