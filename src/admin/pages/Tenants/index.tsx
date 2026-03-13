import * as React from 'react';
import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';

import TenantsListPage from './ListPage';
import TenantCreatePage from './CreatePage';
import TenantEditPage from './EditPage';

const Tenants = () => {
  return (
    <Page.Main>
      <Routes>
        <Route index element={<TenantsListPage />} />
        <Route path="new" element={<TenantCreatePage />} />
        <Route path=":slug" element={<TenantEditPage />} />
      </Routes>
    </Page.Main>
  );
};

export default Tenants;
