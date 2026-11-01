--
-- PostgreSQL database dump
--

\restrict jGkQJH4fyKrAN7XVRv0w37xd7pevHSiBIyNYO7A60Ue2MuKhPxWJTc7TXsNXxml

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user',
    'view'
);


--
-- Name: get_or_create_employee(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_employee(_full_name text, _employee_id text, _photo_path text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _employee_id IS NOT NULL AND _employee_id <> '' THEN
    SELECT id INTO _id FROM employees WHERE employee_id = _employee_id LIMIT 1;
    IF _id IS NOT NULL THEN RETURN _id; END IF;
  END IF;
  INSERT INTO employees (full_name, employee_id, id_photo_path, created_by)
  VALUES (COALESCE(NULLIF(_full_name,''),'Unknown'), NULLIF(_employee_id,''), _photo_path, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, employee_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data ->> 'employee_id'
  );
  -- First user becomes admin, others get 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE WHEN (SELECT COUNT(*) FROM public.user_roles) = 0 THEN 'admin'::app_role ELSE 'user'::app_role END
  );
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    extracted_name text,
    extracted_id text,
    photo_path text NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    employee_id uuid,
    recorded_by uuid,
    project_name text,
    location_lat numeric,
    location_lng numeric,
    location_address text,
    checked_out_at timestamp with time zone,
    total_minutes numeric GENERATED ALWAYS AS (
CASE
    WHEN (checked_out_at IS NOT NULL) THEN (EXTRACT(epoch FROM (checked_out_at - captured_at)) / 60.0)
    ELSE NULL::numeric
END) STORED,
    place text,
    job_title text,
    leave_note text
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    employee_id text,
    id_photo_path text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    total_hours numeric GENERATED ALWAYS AS ((EXTRACT(epoch FROM (end_at - start_at)) / 3600.0)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    employee_id uuid,
    created_by uuid
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    employee_id text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_name text,
    place text
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_id_key UNIQUE (employee_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_employee_id_key UNIQUE (employee_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: projects projects_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_name_key UNIQUE (name);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: attendance attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: attendance admins delete attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete attendance" ON public.attendance FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: employees admins delete employees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete employees" ON public.employees FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles admins delete profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete profiles" ON public.profiles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: projects admins delete projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete projects" ON public.projects FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles admins insert profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (auth.uid() = id)));


--
-- Name: projects admins insert projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert projects" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles admins manage roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage roles" ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: leave_requests admins or creators delete pending leaves; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins or creators delete pending leaves" ON public.leave_requests FOR DELETE TO authenticated USING (((status = 'pending'::text) AND ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::public.app_role))));


--
-- Name: leave_requests admins or creators update leaves; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins or creators update leaves" ON public.leave_requests FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (auth.uid() = created_by)));


--
-- Name: employees admins update employees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update employees" ON public.employees FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles admins update profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update profiles" ON public.profiles FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (auth.uid() = id)));


--
-- Name: projects admins update projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update projects" ON public.projects FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: employees anyone authed can add employees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anyone authed can add employees" ON public.employees FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by));


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance authed insert attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authed insert attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK ((auth.uid() = recorded_by));


--
-- Name: leave_requests authed insert leaves; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authed insert leaves" ON public.leave_requests FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by));


--
-- Name: projects authed read projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authed read projects" ON public.projects FOR SELECT TO authenticated USING (true);


--
-- Name: employees creators or admins or view can read employees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "creators or admins or view can read employees" ON public.employees FOR SELECT TO authenticated USING (((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'view'::public.app_role)));


--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance recorder or admin updates attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "recorder or admin updates attendance" ON public.attendance FOR UPDATE TO authenticated USING (((auth.uid() = recorded_by) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance view attendance scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "view attendance scoped" ON public.attendance FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (auth.uid() = recorded_by) OR (public.has_role(auth.uid(), 'view'::public.app_role) AND ((place IS NULL) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND ((p.place IS NULL) OR (p.place = 'All'::text) OR (p.place = attendance.place)))))))));


--
-- Name: leave_requests view own or admin leaves; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "view own or admin leaves" ON public.leave_requests FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (auth.uid() = created_by) OR (auth.uid() = user_id)));


--
-- Name: profiles view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "view own profile" ON public.profiles FOR SELECT TO authenticated USING (((auth.uid() = id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_roles view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "view own roles" ON public.user_roles FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- PostgreSQL database dump complete
--

\unrestrict jGkQJH4fyKrAN7XVRv0w37xd7pevHSiBIyNYO7A60Ue2MuKhPxWJTc7TXsNXxml

