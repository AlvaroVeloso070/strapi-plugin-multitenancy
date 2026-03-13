import React from 'react';

import {
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Typography,
  Flex,
  Box,
  Button,
} from '@strapi/design-system';

import { Plus, Pencil, Trash, ArrowClockwise } from '@strapi/icons';

import {
  Page,
  Layouts,
  useNotification,
  useFetchClient,
} from '@strapi/strapi/admin';

import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';

import { getTenantsUrl, getTenantUrl, getSyncUrl } from '../../utils/api';


const TenantsListPage = () => {
  const { toggleNotification } = (useNotification as any)();
  const { get, post, del } = (useFetchClient as any)();
  const queryClient = (useQueryClient as any)();
  const navigate = useNavigate();

  const { data: tenants = [], isLoading } = (useQuery as any)({
    queryKey: ['tenants'],
    queryFn: async () => {
      const { data } = await get(getTenantsUrl());
      return data?.data ?? [];
    },
  });

  const deleteMutation = (useMutation as any)({
    mutationFn: (slug: string) => del(getTenantUrl(slug)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toggleNotification({
        type: 'success',
        message: 'Tenant removed successfully',
      });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message ?? err?.message;
      toggleNotification({ type: 'danger', message: msg || 'Error deleting tenant' });
    },
  });

  const syncMutation = (useMutation as any)({
    mutationFn: () => post(getSyncUrl()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toggleNotification({
        type: 'success',
        message: 'Schemas synchronized successfully',
      });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message ?? err?.message;
      toggleNotification({ type: 'danger', message: msg || 'Error synchronizing schemas' });
    },
  });

  if (isLoading) {
    return <Page.Loading />;
  }

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Tenants"
        subtitle="Manage your tenants"
        primaryAction={
          <Flex gap={2}>
            <Button
              variant="secondary"
              startIcon={<ArrowClockwise />}
              onClick={() => syncMutation.mutate()}
              loading={syncMutation.isLoading}
            >
              Sync schemas
            </Button>
            <Button
              startIcon={<Plus />}
              onClick={() => navigate('new')}
            >
              Add tenant
            </Button>
          </Flex>
        }
      />

      <Layouts.Content>
        <Box padding={4}>
          <Table colCount={4} rowCount={tenants.length + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">Slug</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Name</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Schema</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Actions</Typography>
                </Th>
              </Tr>
            </Thead>

            <Tbody>
              {tenants.map((tenant) => (
                <Tr key={tenant.slug}>
                  <Td>
                    <Typography>{tenant.slug}</Typography>
                  </Td>
                  <Td>
                    <Typography>{tenant.name}</Typography>
                  </Td>
                  <Td>
                    <Typography>{tenant.schema}</Typography>
                  </Td>
                  <Td>
                    <Flex gap={2}>
                      <Button
                        size="S"
                        variant="tertiary"
                        startIcon={<Pencil />}
                        onClick={() => navigate(tenant.slug)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="S"
                        startIcon={<Trash />}
                        onClick={() => deleteMutation.mutate(tenant.slug)}
                        loading={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
};

export default TenantsListPage;
